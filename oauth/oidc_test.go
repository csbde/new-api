package oauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOIDCProvider_GetName(t *testing.T) {
	settings := system_setting.GetOIDCSettings()
	originalDisplayName := settings.DisplayName
	defer func() { settings.DisplayName = originalDisplayName }()

	p := &OIDCProvider{}

	settings.DisplayName = ""
	assert.Equal(t, "OIDC", p.GetName())

	settings.DisplayName = "  Acme SSO  "
	assert.Equal(t, "Acme SSO", p.GetName())
}

func TestOIDCProvider_GetUserInfo_EmailVerified(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	settings := system_setting.GetOIDCSettings()
	oldEndpoint := settings.UserInfoEndpoint
	settings.UserInfoEndpoint = srv.URL
	defer func() { settings.UserInfoEndpoint = oldEndpoint }()

	p := &OIDCProvider{}
	token := &OAuthToken{AccessToken: "test-token"}

	body = `{"sub":"oidc-sub-1","email":"Alice@Example.com","email_verified":true,"preferred_username":"alice","name":"Alice"}`
	u, err := p.GetUserInfo(context.Background(), token)
	require.NoError(t, err)
	assert.Equal(t, "oidc-sub-1", u.ProviderUserID)
	assert.Equal(t, "Alice@Example.com", u.Email)
	assert.True(t, u.EmailVerified)

	body = `{"sub":"oidc-sub-2","email":"bob@example.com","email_verified":false}`
	u, err = p.GetUserInfo(context.Background(), token)
	require.NoError(t, err)
	assert.False(t, u.EmailVerified)

	body = `{"sub":"oidc-sub-3","email":"carol@example.com"}`
	u, err = p.GetUserInfo(context.Background(), token)
	require.NoError(t, err)
	assert.False(t, u.EmailVerified)
}
