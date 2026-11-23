package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestComboModelValidation(t *testing.T) {
	tests := []struct {
		name    string
		combo   *model.Combo
		wantErr bool
	}{
		{
			name: "empty name",
			combo: &model.Combo{
				Name:     "",
				Strategy: model.ComboStrategyFallback,
				Models:   []string{"gpt-4o"},
			},
			wantErr: true,
		},
		{
			name: "invalid strategy",
			combo: &model.Combo{
				Name:     "test-combo",
				Strategy: "unknown_strategy",
				Models:   []string{"gpt-4o"},
			},
			wantErr: true,
		},
		{
			name: "empty models",
			combo: &model.Combo{
				Name:     "test-combo",
				Strategy: model.ComboStrategyRoundRobin,
				Models:   []string{},
			},
			wantErr: true,
		},
		{
			name: "valid fallback combo",
			combo: &model.Combo{
				Name:     "test-fallback",
				Strategy: model.ComboStrategyFallback,
				Models:   []string{"claude-3-7-sonnet", "gpt-4o"},
			},
			wantErr: false,
		},
		{
			name: "valid smart router combo with default settings",
			combo: &model.Combo{
				Name:     "test-smart",
				Strategy: model.ComboStrategySmartRouter,
				Models:   []string{"gpt-4o-mini", "claude-3-7-sonnet"},
				Settings: &model.ComboStrategySettings{
					SmartMode:           model.ComboSmartModeStrictLock,
					HysteresisThreshold: 0.25,
				},
			},
			wantErr: false,
		},
		{
			name: "valid fusion combo",
			combo: &model.Combo{
				Name:     "test-fusion",
				Strategy: model.ComboStrategyFusion,
				Models:   []string{"gpt-4o", "claude-3-7-sonnet", "deepseek-chat"},
				Settings: &model.ComboStrategySettings{
					JudgeModel: "gpt-4o",
				},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.combo.Validate()
			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestResolveRoundRobin(t *testing.T) {
	combo := &model.Combo{
		Name:     "rr-combo-test",
		Strategy: model.ComboStrategyRoundRobin,
		Models:   []string{"model-a", "model-b", "model-c"},
	}

	results := make([]string, 6)
	for i := range results {
		results[i] = ResolveRoundRobin(combo)
	}

	assert.Equal(t, "model-a", results[0])
	assert.Equal(t, "model-b", results[1])
	assert.Equal(t, "model-c", results[2])
	assert.Equal(t, "model-a", results[3])
	assert.Equal(t, "model-b", results[4])
	assert.Equal(t, "model-c", results[5])
}

func TestGetNextFallbackModel(t *testing.T) {
	combo := &model.Combo{
		Name:     "fallback-combo-test",
		Strategy: model.ComboStrategyFallback,
		Models:   []string{"primary-m", "secondary-m", "last-resort-m"},
	}

	// Turn 0 -> Next is Turn 1
	nextModel, nextIdx, hasNext := GetNextFallbackModel(combo, 0)
	require.True(t, hasNext)
	assert.Equal(t, "secondary-m", nextModel)
	assert.Equal(t, 1, nextIdx)

	// Turn 1 -> Next is Turn 2
	nextModel, nextIdx, hasNext = GetNextFallbackModel(combo, 1)
	require.True(t, hasNext)
	assert.Equal(t, "last-resort-m", nextModel)
	assert.Equal(t, 2, nextIdx)

	// Turn 2 -> End of chain
	_, _, hasNext = GetNextFallbackModel(combo, 2)
	assert.False(t, hasNext)
}

func TestSmartRouterModes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("X-Session-ID", "test-session-123")
	c.Request = req

	comboStrict := &model.Combo{
		Name:     "smart-strict-test",
		Strategy: model.ComboStrategySmartRouter,
		Models:   []string{"model-fast", "model-powerful"},
		Settings: &model.ComboStrategySettings{
			SmartMode: model.ComboSmartModeStrictLock,
		},
	}

	sessionKey := fmt.Sprintf("%s_%s", comboStrict.Name, ExtractSessionKey(c, "Write a complex backend"))

	// Pre-seed cache to simulate a locked session (+0ms latency)
	smartRouterSessionLock.Lock()
	smartRouterSessionCache[sessionKey] = smartSessionEntry{
		Model:      "model-powerful",
		Confidence: 0.95,
		ExpiresAt:  time.Now().Add(time.Hour),
	}
	smartRouterSessionLock.Unlock()

	// Should immediately return locked model without running decision model
	selected := ResolveSmartRouter(context.Background(), c, comboStrict, "Write a complex backend")
	assert.Equal(t, "model-powerful", selected)

	// Test Adaptive Hysteresis (Smart Switch):
	comboHysteresis := &model.Combo{
		Name:     "smart-switch-test",
		Strategy: model.ComboStrategySmartRouter,
		Models:   []string{"model-fast", "model-powerful"},
		Settings: &model.ComboStrategySettings{
			SmartMode:           model.ComboSmartModeSmartSwitch,
			HysteresisThreshold: 0.3,
		},
	}

	hSessionKey := fmt.Sprintf("%s_%s", comboHysteresis.Name, ExtractSessionKey(c, "Fix a typo"))
	smartRouterSessionLock.Lock()
	smartRouterSessionCache[hSessionKey] = smartSessionEntry{
		Model:      "model-fast",
		Confidence: 0.8,
		ExpiresAt:  time.Now().Add(time.Hour),
	}
	smartRouterSessionLock.Unlock()

	// Query with small prompt, should retain previous model due to hysteresis threshold
	resH := ResolveSmartRouter(context.Background(), c, comboHysteresis, "Fix a typo")
	assert.Equal(t, "model-fast", resH)
}

func TestBuildFusionSynthesisPrompt(t *testing.T) {
	userPrompt := "What are the key trade-offs between SQL and NoSQL?"
	panelResults := []PanelExecutionResult{
		{ModelName: "gpt-4o", Content: "SQL guarantees ACID compliance while NoSQL excels at flexible horizontal scaling."},
		{ModelName: "claude-3-7-sonnet", Content: "Relational DBs provide strict schemas, while Document DBs provide schema evolution speed."},
		{ModelName: "failing-model", Error: fmt.Errorf("timeout")},
	}

	prompt := BuildFusionSynthesisPrompt(userPrompt, panelResults, "")

	assert.Contains(t, prompt, "=== USER PROMPT ===")
	assert.Contains(t, prompt, userPrompt)
	assert.Contains(t, prompt, "=== CANDIDATE MODEL RESPONSES ===")
	assert.Contains(t, prompt, "--- Response from [gpt-4o] ---")
	assert.Contains(t, prompt, "SQL guarantees ACID compliance")
	assert.Contains(t, prompt, "--- Response from [claude-3-7-sonnet] ---")
	assert.Contains(t, prompt, "Relational DBs provide strict schemas")
	assert.NotContains(t, prompt, "failing-model")
}

func TestComboDBCRUD(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Combo{}))

	oldDB := model.DB
	model.DB = db
	defer func() { model.DB = oldDB }()

	combo := &model.Combo{
		Name:        "coding-suite",
		Description: "Fallback coding models",
		Strategy:    model.ComboStrategyFallback,
		Models:      []string{"claude-3-7-sonnet", "gpt-4o"},
		Status:      model.ComboStatusEnabled,
		Settings: &model.ComboStrategySettings{
			JudgeModel: "claude-3-7-sonnet",
		},
	}

	require.NoError(t, combo.Insert())
	require.True(t, combo.Id > 0)

	fetched, err := model.GetComboById(combo.Id)
	require.NoError(t, err)
	assert.Equal(t, "coding-suite", fetched.Name)
	assert.Equal(t, model.ComboStrategyFallback, fetched.Strategy)
	assert.Equal(t, []string{"claude-3-7-sonnet", "gpt-4o"}, fetched.Models)
	assert.Equal(t, "claude-3-7-sonnet", fetched.Settings.JudgeModel)

	fetched.Description = "Updated description"
	fetched.Models = []string{"claude-3-7-sonnet", "gpt-4o", "deepseek-chat"}
	require.NoError(t, fetched.Update())

	updated, err := model.GetComboByName("coding-suite")
	require.NoError(t, err)
	assert.Equal(t, "Updated description", updated.Description)
	assert.Equal(t, 3, len(updated.Models))

	require.NoError(t, model.DeleteComboById(combo.Id))
	_, err = model.GetComboById(combo.Id)
	require.Error(t, err)
}

func TestComboGroupSupport(t *testing.T) {
	allGroupCombo := &model.Combo{
		Name:     "all-group-combo",
		Group:    "",
		Strategy: model.ComboStrategyFallback,
		Models:   []string{"gpt-4o"},
		Status:   model.ComboStatusEnabled,
	}
	assert.Empty(t, allGroupCombo.GetGroups())
	assert.True(t, allGroupCombo.HasGroup("default"))
	assert.True(t, allGroupCombo.HasGroup("vip"))

	multiGroupCombo := &model.Combo{
		Name:     "vip-combo",
		Group:    "vip, svip",
		Strategy: model.ComboStrategyFallback,
		Models:   []string{"claude-3-5-sonnet"},
		Status:   model.ComboStatusEnabled,
	}
	assert.ElementsMatch(t, []string{"vip", "svip"}, multiGroupCombo.GetGroups())
	assert.True(t, multiGroupCombo.HasGroup("vip"))
	assert.True(t, multiGroupCombo.HasGroup("svip"))
	assert.False(t, multiGroupCombo.HasGroup("default"))

	// Test cache and ListEnabledCombosForGroup
	combosCacheLock.Lock()
	combosCache = map[string]*model.Combo{
		allGroupCombo.Name:   allGroupCombo,
		multiGroupCombo.Name: multiGroupCombo,
	}
	combosCacheLock.Unlock()

	defaultCombos := ListEnabledCombosForGroup("default")
	require.Len(t, defaultCombos, 1)
	assert.Equal(t, "all-group-combo", defaultCombos[0].Name)

	vipCombos := ListEnabledCombosForGroup("vip")
	require.Len(t, vipCombos, 2)

	// Test GetGroupsEnabledModels includes combos
	modelsForDefault := GetGroupsEnabledModels([]string{"default"})
	assert.Contains(t, modelsForDefault, "all-group-combo")
	assert.NotContains(t, modelsForDefault, "vip-combo")

	modelsForVip := GetGroupsEnabledModels([]string{"vip"})
	assert.Contains(t, modelsForVip, "all-group-combo")
	assert.Contains(t, modelsForVip, "vip-combo")
}
