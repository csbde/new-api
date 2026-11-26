package controller

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetDeepSeekBalanceUSD(t *testing.T) {
	tests := []struct {
		name            string
		responseJSON    string
		usdExchangeRate float64
		want            float64
		wantErrContains string
	}{
		{
			name:            "prefers USD when USD precedes CNY",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"12.50"},{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 7.3,
			want:            12.5,
		},
		{
			name:            "prefers USD when CNY precedes USD",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"},{"currency":"USD","total_balance":"12.50"}]}`,
			usdExchangeRate: 7.3,
			want:            12.5,
		},
		{
			name:            "converts CNY when USD is absent",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 7.3,
			want:            10,
		},
		{
			name:            "converts CNY when USD balance is zero",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"0.00"},{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 7.3,
			want:            10,
		},
		{
			name:            "converts CNY when zero USD follows CNY",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"},{"currency":"USD","total_balance":"0.00"}]}`,
			usdExchangeRate: 7.3,
			want:            10,
		},
		{
			name:            "returns zero when USD balance is zero and CNY is absent",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"0.00"}]}`,
			usdExchangeRate: 7.3,
			want:            0,
		},
		{
			name:            "returns error when USD and CNY are absent",
			responseJSON:    `{"balance_infos":[{"currency":"EUR","total_balance":"10.00"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "currency USD or CNY not found",
		},
		{
			name:            "returns USD parse error instead of falling back to CNY",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"invalid"},{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "invalid syntax",
		},
		{
			name:            "rejects NaN USD balance",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"NaN"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "USD balance must be finite",
		},
		{
			name:            "rejects negative USD balance",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"-1.00"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "USD balance must be non-negative",
		},
		{
			name:            "rejects positive infinity CNY balance",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"+Inf"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "CNY balance must be finite",
		},
		{
			name:            "rejects negative CNY balance",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"-7.30"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "CNY balance must be non-negative",
		},
		{
			name:            "returns error for non-positive CNY exchange rate",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 0,
			wantErrContains: "USD exchange rate must be greater than zero",
		},
		{
			name:            "rejects NaN CNY exchange rate",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: math.NaN(),
			wantErrContains: "USD exchange rate must be finite",
		},
		{
			name:            "rejects positive infinity CNY exchange rate",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: math.Inf(1),
			wantErrContains: "USD exchange rate must be finite",
		},
		{
			name:            "rejects CNY conversion overflow",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"1.7976931348623157e+308"}]}`,
			usdExchangeRate: math.SmallestNonzeroFloat64,
			wantErrContains: "converted USD balance must be finite",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var response DeepSeekUsageResponse
			require.NoError(t, common.Unmarshal([]byte(test.responseJSON), &response))

			balance, err := getDeepSeekBalanceUSD(response, test.usdExchangeRate)
			if test.wantErrContains != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), test.wantErrContains)
				return
			}

			require.NoError(t, err)
			assert.InDelta(t, test.want, balance, 1e-12)
		})
	}
}

func TestUpdateChannelNewAPIBalanceUsesTheSmallerRemainingQuota(t *testing.T) {
	for _, tc := range []struct {
		name    string
		usage   string
		want    float64
		wantErr string
	}{
		{name: "user quota below the key quota", usage: `{"code":true,"data":{"total_available":2000000,"unlimited_quota":false,"user_quota":{"total_available":500000}}}`, want: 0.5},
		{name: "key quota below the user quota", usage: `{"code":true,"data":{"total_available":500000,"unlimited_quota":false,"user_quota":{"total_available":2000000}}}`, want: 0.5},
		{name: "unlimited key uses the user quota", usage: `{"code":true,"data":{"total_available":0,"unlimited_quota":true,"user_quota":{"total_available":3000000}}}`, want: 3},
		{name: "key quota alone without user quota", usage: `{"code":true,"data":{"total_available":1500000,"unlimited_quota":false}}`, want: 1.5},
		{name: "unlimited key without user quota", usage: `{"code":true,"data":{"total_available":0,"unlimited_quota":true}}`, wantErr: "Allow querying user quota"},
		{name: "upstream rejects the key", usage: `{"success":false,"message":"invalid token"}`, wantErr: "invalid token"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupSub2APIBalanceTest(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/usage/token/":
					assert.Equal(t, "Bearer sk-upstream", r.Header.Get("Authorization"))
					_, _ = w.Write([]byte(tc.usage))
				case "/api/status":
					assert.Empty(t, r.Header.Get("Authorization"), "the key is not sent to the public status endpoint")
					_, _ = w.Write([]byte(`{"success":true,"data":{"quota_per_unit":1000000}}`))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			baseURL := server.URL + "/"
			channel := &model.Channel{Type: constant.ChannelTypeNewAPI, BaseURL: &baseURL, Key: "sk-upstream", Name: "new-api-upstream"}
			require.NoError(t, model.DB.Create(channel).Error)

			result, err := updateChannelBalance(channel)
			if tc.wantErr != "" {
				require.ErrorContains(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.InDelta(t, tc.want, result.Balance, 1e-9)
			assert.InDelta(t, tc.want, channel.Balance, 1e-9)
		})
	}
}

func TestUpdateBuiltinMultiKeyChannelBalanceAndCustomMapping(t *testing.T) {
	setupSub2APIBalanceTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/custom/balance":
			switch r.Header.Get("Authorization") {
			case "Bearer sk-1":
				_, _ = w.Write([]byte(`{"data":{"limit":1000}}`))
			case "Bearer sk-2":
				_, _ = w.Write([]byte(`{"data":{"limit":2500}}`))
			default:
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			}
		case "/custom/usage":
			switch r.Header.Get("Authorization") {
			case "Bearer sk-1":
				_, _ = w.Write([]byte(`{"data":{"used":250}}`))
			case "Bearer sk-2":
				_, _ = w.Write([]byte(`{"data":{"used":500}}`))
			default:
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	baseURL := server.URL
	otherSettings := `{"balance_query":{"balance_url":"/custom/balance","usage_url":"/custom/usage","total_field":"data.limit","usage_field":"data.used","balance_divisor":100,"usage_divisor":100,"currency":"USD"}}`
	channel := &model.Channel{
		Type:          constant.ChannelTypeOpenAI,
		BaseURL:       &baseURL,
		Key:           "sk-1\nsk-2",
		Name:          "openai-multi-custom",
		OtherSettings: otherSettings,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 2,
		},
	}
	require.NoError(t, model.DB.Create(channel).Error)

	result, err := updateChannelBalance(channel)
	require.NoError(t, err)
	require.NotNil(t, result.Detail)
	// Key 0: (1000-250)/100 = 7.5; Key 1: (2500-500)/100 = 20; Total = 27.5
	assert.InDelta(t, 27.5, result.Balance, 1e-9)
	require.NotNil(t, result.Detail.Keys["0"].Amount)
	require.NotNil(t, result.Detail.Keys["1"].Amount)
	assert.InDelta(t, 7.5, *result.Detail.Keys["0"].Amount, 1e-9)
	assert.InDelta(t, 20.0, *result.Detail.Keys["1"].Amount, 1e-9)

	var stored model.Channel
	require.NoError(t, model.DB.First(&stored, channel.Id).Error)
	assert.InDelta(t, 27.5, stored.Balance, 1e-9)
}

func TestUpdateChannelPureUsagePostAndMagpiePath(t *testing.T) {
	setupSub2APIBalanceTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/magpie/usage", r.URL.Path)
		_, _ = w.Write([]byte(`{"data":{"used_amount":"1250"}}`))
	}))
	defer server.Close()

	baseURL := server.URL
	otherSettings := `{"balance_query":{"method":"POST","show_usage":true,"show_balance":false,"usage_url":"/magpie/usage","usage_field":"$data.used_amount","usage_divisor":100,"currency":"USD"}}`
	channel := &model.Channel{
		Type:          constant.ChannelTypeOpenAI,
		BaseURL:       &baseURL,
		Key:           "sk-magpie",
		Name:          "magpie-usage-only",
		OtherSettings: otherSettings,
	}
	require.NoError(t, model.DB.Create(channel).Error)

	result, err := updateChannelBalance(channel)
	require.NoError(t, err)
	require.NotNil(t, result.Detail)
	require.Len(t, result.Detail.Windows, 1)
	assert.InDelta(t, 12.5, result.Detail.Windows[0].Used, 1e-9)
	assert.Equal(t, "USD", result.Detail.Windows[0].Unit)
}

func TestUpdateChannelSimultaneousBalanceAndUsageFields(t *testing.T) {
	setupSub2APIBalanceTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bal":
			_, _ = w.Write([]byte(`{"remaining":45.5}`))
		case "/use":
			_, _ = w.Write([]byte(`{"used":14.25}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	baseURL := server.URL
	otherSettings := `{"balance_query":{"balance_url":"/bal","usage_url":"/use","balance_field":"remaining","usage_field":"used","currency":"USD"}}`
	channel := &model.Channel{
		Type:          constant.ChannelTypeOpenAI,
		BaseURL:       &baseURL,
		Key:           "sk-both",
		Name:          "both-fields",
		OtherSettings: otherSettings,
	}
	require.NoError(t, model.DB.Create(channel).Error)

	result, err := updateChannelBalance(channel)
	require.NoError(t, err)
	assert.InDelta(t, 45.5, result.Balance, 1e-9)
	require.NotNil(t, result.Detail)
	require.Len(t, result.Detail.Windows, 1)
	assert.InDelta(t, 14.25, result.Detail.Windows[0].Used, 1e-9)
}
