package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMultiKeyEnableRestoresOnlyExhaustedChannels(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousMaster, previousCache, previousRedis, previousSQLite := common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousType, previousLogType)
		common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath = previousMaster, previousCache, previousRedis, previousSQLite
	})
	t.Setenv("SQL_DSN", os.Getenv("TEST_CHANNEL_SQL_DSN"))
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "channel.db")
	require.NoError(t, model.InitDB())
	database := model.DB
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	model.LOG_DB = database
	common.SetLogDatabaseType(common.MainDatabaseType())
	require.NoError(t, database.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.User{}, &model.Log{}, &model.AuditLog{}))
	root := &model.User{Username: "multi-key-review-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	require.NoError(t, database.Create(root).Error)
	t.Cleanup(func() { require.NoError(t, database.Unscoped().Delete(root).Error) })
	versionQuery := "SELECT VERSION()"
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		versionQuery = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, database.Raw(versionQuery).Scan(&version).Error)
	t.Logf("database=%s version=%s", common.MainDatabaseType(), version)

	for _, cacheEnabled := range []bool{false, true} {
		for _, action := range []string{"enable_key", "enable_all_keys"} {
			for _, tc := range []struct {
				name           string
				initialStatus  int
				autoExhaust    bool
				manualOverride string
				wantStatus     int
			}{
				{name: "key exhaustion restores", initialStatus: common.ChannelStatusEnabled, wantStatus: common.ChannelStatusEnabled},
				{name: "manual disable is preserved", initialStatus: common.ChannelStatusManuallyDisabled, wantStatus: common.ChannelStatusManuallyDisabled},
				{name: "manual disable after exhaustion is preserved", initialStatus: common.ChannelStatusEnabled, manualOverride: "status", wantStatus: common.ChannelStatusManuallyDisabled},
				{name: "tag disable after exhaustion is preserved", initialStatus: common.ChannelStatusEnabled, manualOverride: "tag", wantStatus: common.ChannelStatusManuallyDisabled},
				{name: "auto key exhaustion restores", initialStatus: common.ChannelStatusEnabled, autoExhaust: true, wantStatus: common.ChannelStatusEnabled},
				{name: "auto disable for another reason is preserved", initialStatus: common.ChannelStatusAutoDisabled, wantStatus: common.ChannelStatusAutoDisabled},
				{name: "manual disable after auto exhaustion is preserved", initialStatus: common.ChannelStatusEnabled, autoExhaust: true, manualOverride: "status", wantStatus: common.ChannelStatusManuallyDisabled},
				{name: "tag disable after auto exhaustion is preserved", initialStatus: common.ChannelStatusEnabled, autoExhaust: true, manualOverride: "tag", wantStatus: common.ChannelStatusManuallyDisabled},
			} {
				t.Run(fmt.Sprintf("cache=%t/%s/%s", cacheEnabled, action, tc.name), func(t *testing.T) {
					common.MemoryCacheEnabled = cacheEnabled
					tag := t.Name()
					channel := &model.Channel{Name: t.Name(), Type: 1, Key: "key-one\nkey-two", Status: tc.initialStatus, Models: "test-model", Group: "default", Tag: &tag,
						ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyStatusList: map[int]int{1: common.ChannelStatusManuallyDisabled}},
					}
					require.NoError(t, channel.Insert())
					t.Cleanup(func() {
						require.NoError(t, channel.Delete())
						model.InitChannelCache()
					})
					operations := []string{"disable_key", action}
					if tc.autoExhaust {
						// Key two is already disabled, so a request failure on key
						// one disables the whole channel automatically.
						model.InitChannelCache()
						require.True(t, model.UpdateChannelStatus(channel.Id, "key-one", common.ChannelStatusAutoDisabled, "provider rejected key"))
						exhausted, err := model.GetChannelById(channel.Id, true)
						require.NoError(t, err)
						require.Equal(t, common.ChannelStatusAutoDisabled, exhausted.Status)
						operations = []string{action}
					}
					for _, operation := range operations {
						if operation == action {
							if tc.manualOverride == "status" {
								model.UpdateChannelStatus(channel.Id, "", common.ChannelStatusManuallyDisabled, "manual operation")
							} else if tc.manualOverride == "tag" {
								require.NoError(t, model.DisableChannelByTag(tag))
							}
						}
						payload, err := common.Marshal(MultiKeyManageRequest{ChannelId: channel.Id, Action: operation, KeyIndex: common.GetPointer(0)})
						require.NoError(t, err)
						recorder := httptest.NewRecorder()
						c, _ := gin.CreateTestContext(recorder)
						c.Set("id", root.Id)
						c.Set("role", common.RoleRootUser)
						c.Request = httptest.NewRequest(http.MethodPost, "/api/channel/multi_key", bytes.NewReader(payload))
						c.Request.Header.Set("Content-Type", "application/json")
						ManageMultiKeys(c)
						var result struct {
							Success bool `json:"success"`
						}
						require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
						require.True(t, result.Success, recorder.Body.String())
					}
					loaded, err := model.GetChannelById(channel.Id, true)
					require.NoError(t, err)
					assert.Equal(t, tc.wantStatus, loaded.Status)
					if tc.wantStatus == common.ChannelStatusEnabled {
						assert.Equal(t, "", loaded.GetOtherInfo()["status_reason"])
					}
					assert.NotContains(t, loaded.ChannelInfo.MultiKeyStatusList, 0)
					assert.NotContains(t, loaded.ChannelInfo.MultiKeyDisabledReason, 0)
					assert.NotContains(t, loaded.ChannelInfo.MultiKeyDisabledTime, 0)
					var ability model.Ability
					require.NoError(t, database.Where("channel_id = ?", channel.Id).First(&ability).Error)
					assert.Equal(t, tc.wantStatus == common.ChannelStatusEnabled, ability.Enabled)
				})
			}
		}
	}
}

func TestMultiKeyAddKeysAndAutoUpgrade(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousMaster, previousCache, previousRedis, previousSQLite := common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousType, previousLogType)
		common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath = previousMaster, previousCache, previousRedis, previousSQLite
	})
	t.Setenv("SQL_DSN", "")
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "channel_add_keys.db")
	require.NoError(t, model.InitDB())
	database := model.DB
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	model.LOG_DB = database
	common.SetLogDatabaseType(common.MainDatabaseType())
	require.NoError(t, database.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.User{}, &model.Log{}, &model.AuditLog{}))

	root := &model.User{Username: "add-keys-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	require.NoError(t, database.Create(root).Error)
	t.Cleanup(func() { require.NoError(t, database.Unscoped().Delete(root).Error) })

	// 1. Channel initially has IsMultiKey = false
	channel := &model.Channel{
		Name:   "legacy-single-channel",
		Type:   1,
		Key:    "key-initial",
		Status: common.ChannelStatusEnabled,
		Models: "gpt-4o-mini",
		Group:  "default",
	}
	require.NoError(t, channel.Insert())
	t.Cleanup(func() {
		require.NoError(t, channel.Delete())
		model.InitChannelCache()
	})

	// 2. Call ManageMultiKeys with get_key_status: should auto-upgrade to IsMultiKey = true
	reqPayload, err := common.Marshal(MultiKeyManageRequest{
		ChannelId: channel.Id,
		Action:    "get_key_status",
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", root.Id)
	c.Set("role", common.RoleRootUser)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/channel/multi_key", bytes.NewReader(reqPayload))
	c.Request.Header.Set("Content-Type", "application/json")
	ManageMultiKeys(c)

	var statusResp struct {
		Success bool                   `json:"success"`
		Data    MultiKeyStatusResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &statusResp))
	require.True(t, statusResp.Success)
	require.Len(t, statusResp.Data.Keys, 1)
	assert.Equal(t, 1, statusResp.Data.EnabledCount)

	// Check channel in DB was auto-upgraded
	upgraded, err := model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.True(t, upgraded.ChannelInfo.IsMultiKey)
	assert.Equal(t, 1, upgraded.ChannelInfo.MultiKeySize)

	// 3. Add new keys via action: "add_keys"
	addPayload, err := common.Marshal(MultiKeyManageRequest{
		ChannelId: channel.Id,
		Action:    "add_keys",
		Keys:      "key-two\nkey-three\nkey-initial", // key-initial is duplicate, should be skipped
	})
	require.NoError(t, err)
	recAdd := httptest.NewRecorder()
	cAdd, _ := gin.CreateTestContext(recAdd)
	cAdd.Set("id", root.Id)
	cAdd.Set("role", common.RoleRootUser)
	cAdd.Request = httptest.NewRequest(http.MethodPost, "/api/channel/multi_key", bytes.NewReader(addPayload))
	cAdd.Request.Header.Set("Content-Type", "application/json")
	ManageMultiKeys(cAdd)

	var addResp struct {
		Success bool `json:"success"`
		Data    int  `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recAdd.Body.Bytes(), &addResp))
	require.True(t, addResp.Success, recAdd.Body.String())
	assert.Equal(t, 2, addResp.Data) // exactly 2 keys added (key-two, key-three)

	// Verify keys in channel
	storedAfterAdd, err := model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	assert.Equal(t, 3, storedAfterAdd.ChannelInfo.MultiKeySize)
	allKeys := storedAfterAdd.GetKeys()
	assert.Equal(t, []string{"key-initial", "key-two", "key-three"}, allKeys)

	// 4. Adding duplicate keys only should return message that all keys exist
	dupPayload, err := common.Marshal(MultiKeyManageRequest{
		ChannelId: channel.Id,
		Action:    "add_keys",
		Keys:      "key-two\nkey-three",
	})
	require.NoError(t, err)
	recDup := httptest.NewRecorder()
	cDup, _ := gin.CreateTestContext(recDup)
	cDup.Set("id", root.Id)
	cDup.Set("role", common.RoleRootUser)
	cDup.Request = httptest.NewRequest(http.MethodPost, "/api/channel/multi_key", bytes.NewReader(dupPayload))
	cDup.Request.Header.Set("Content-Type", "application/json")
	ManageMultiKeys(cDup)

	var dupResp struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recDup.Body.Bytes(), &dupResp))
	assert.False(t, dupResp.Success)

	// 5. Test explicit key index selection
	cTest, _ := gin.CreateTestContext(httptest.NewRecorder())
	cTest.Set("id", root.Id)
	require.Nil(t, middleware.SetupContextForSelectedChannel(cTest, storedAfterAdd, "gpt-4o-mini", 1))
	assert.Equal(t, "key-two", common.GetContextKeyString(cTest, constant.ContextKeyChannelKey))
	assert.Equal(t, 1, common.GetContextKeyInt(cTest, constant.ContextKeyChannelMultiKeyIndex))
}
