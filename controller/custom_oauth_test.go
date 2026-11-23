package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFetchCustomOAuthDiscovery(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("empty URLs return error", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		body := bytes.NewBufferString(`{}`)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/custom-oauth-provider/discovery", body)
		c.Request.Header.Set("Content-Type", "application/json")

		FetchCustomOAuthDiscovery(c)

		assert.Equal(t, http.StatusOK, w.Code)
		var resp map[string]any
		err := common.Unmarshal(w.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, false, resp["success"])
		assert.Contains(t, resp["message"], "Enter the Discovery URL or Issuer URL first")
	})

	t.Run("invalid scheme returns error", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		body := bytes.NewBufferString(`{"well_known_url": "ftp://example.com"}`)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/custom-oauth-provider/discovery", body)
		c.Request.Header.Set("Content-Type", "application/json")

		FetchCustomOAuthDiscovery(c)

		assert.Equal(t, http.StatusOK, w.Code)
		var resp map[string]any
		err := common.Unmarshal(w.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.Equal(t, false, resp["success"])
		assert.Contains(t, resp["message"], "Only http and https are supported")
	})

	t.Run("normalizes issuer URL and fetches discovery", func(t *testing.T) {
		var requestedPath string
		server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			requestedPath = r.URL.Path
			rw.Header().Set("Content-Type", "application/json")
			rw.WriteHeader(http.StatusOK)
			_, _ = rw.Write([]byte(`{
				"authorization_endpoint": "https://provider.example.com/auth",
				"token_endpoint": "https://provider.example.com/token",
				"userinfo_endpoint": "https://provider.example.com/userinfo"
			}`))
		}))
		defer server.Close()

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		reqPayload := `{"issuer_url": "` + server.URL + `"}`
		c.Request = httptest.NewRequest(http.MethodPost, "/api/custom-oauth-provider/discovery", bytes.NewBufferString(reqPayload))
		c.Request.Header.Set("Content-Type", "application/json")

		FetchCustomOAuthDiscovery(c)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "/.well-known/openid-configuration", requestedPath)

		var resp struct {
			Success bool   `json:"success"`
			Message string `json:"message"`
			Data    struct {
				WellKnownURL string                 `json:"well_known_url"`
				Discovery    map[string]interface{} `json:"discovery"`
			} `json:"data"`
		}
		err := common.Unmarshal(w.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.True(t, resp.Success)
		assert.Equal(t, server.URL+"/.well-known/openid-configuration", resp.Data.WellKnownURL)
		assert.Equal(t, "https://provider.example.com/auth", resp.Data.Discovery["authorization_endpoint"])
	})

	t.Run("normalizes well_known_url without path", func(t *testing.T) {
		var requestedPath string
		server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			requestedPath = r.URL.Path
			rw.Header().Set("Content-Type", "application/json")
			rw.WriteHeader(http.StatusOK)
			_, _ = rw.Write([]byte(`{
				"authorization_endpoint": "https://provider.example.com/auth"
			}`))
		}))
		defer server.Close()

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		reqPayload := `{"well_known_url": "` + server.URL + `"}`
		c.Request = httptest.NewRequest(http.MethodPost, "/api/custom-oauth-provider/discovery", bytes.NewBufferString(reqPayload))
		c.Request.Header.Set("Content-Type", "application/json")

		FetchCustomOAuthDiscovery(c)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "/.well-known/openid-configuration", requestedPath)

		var resp struct {
			Success bool `json:"success"`
			Data    struct {
				WellKnownURL string `json:"well_known_url"`
			} `json:"data"`
		}
		err := common.Unmarshal(w.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.True(t, resp.Success)
		assert.Equal(t, server.URL+"/.well-known/openid-configuration", resp.Data.WellKnownURL)
	})
}
