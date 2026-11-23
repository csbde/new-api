package service

import (
	"bytes"
	"context"
	"fmt"
	"hash/fnv"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

var (
	combosCacheLock sync.RWMutex
	combosCache     = make(map[string]*model.Combo)

	roundRobinCounters sync.Map // map[string]*atomic.Uint64

	smartRouterSessionLock  sync.RWMutex
	smartRouterSessionCache = make(map[string]smartSessionEntry)
)

type smartSessionEntry struct {
	Model      string
	Confidence float64
	ExpiresAt  time.Time
}

// RouterProvider allows decoupling internal HTTP requests from the router package.
var RouterProvider func() *gin.Engine

// InitCombos loads all enabled combos into memory cache.
func InitCombos() error {
	combos, err := model.GetAllEnabledCombos()
	if err != nil {
		return err
	}
	newMap := make(map[string]*model.Combo, len(combos))
	for _, c := range combos {
		newMap[c.Name] = c
	}
	combosCacheLock.Lock()
	combosCache = newMap
	combosCacheLock.Unlock()
	return nil
}

// ReloadCombos refreshes the combos cache.
func ReloadCombos() error {
	return InitCombos()
}

// GetComboByName returns an active combo by name from cache.
func GetComboByName(name string) (*model.Combo, bool) {
	combosCacheLock.RLock()
	defer combosCacheLock.RUnlock()
	combo, ok := combosCache[name]
	return combo, ok
}

// IsCombo checks if name is an enabled combo.
func IsCombo(name string) bool {
	_, ok := GetComboByName(name)
	return ok
}

// ListEnabledCombosForGroup returns all enabled combos for a group.
func ListEnabledCombosForGroup(group string) []*model.Combo {
	combosCacheLock.RLock()
	defer combosCacheLock.RUnlock()
	list := make([]*model.Combo, 0, len(combosCache))
	for _, c := range combosCache {
		if c.HasGroup(group) {
			list = append(list, c)
		}
	}
	return list
}

// ResolveRoundRobin selects the next model in a round-robin combo.
func ResolveRoundRobin(combo *model.Combo) string {
	if len(combo.Models) == 0 {
		return ""
	}
	if len(combo.Models) == 1 {
		return combo.Models[0]
	}
	val, _ := roundRobinCounters.LoadOrStore(combo.Name, new(atomic.Uint64))
	counter := val.(*atomic.Uint64)
	idx := counter.Add(1) - 1
	return combo.Models[idx%uint64(len(combo.Models))]
}

// ExtractSessionKey extracts a session identifier for sticky routing and prompt cache retention.
func ExtractSessionKey(c *gin.Context, promptText string) string {
	if c != nil && c.Request != nil {
		if sid := c.Request.Header.Get("X-Session-ID"); sid != "" {
			return "hdr_" + sid
		}
		if cid := c.Request.Header.Get("X-Conversation-ID"); cid != "" {
			return "hdr_" + cid
		}
		if sid := c.Request.Header.Get("Session-ID"); sid != "" {
			return "hdr_" + sid
		}
	}

	h := fnv.New64a()
	if c != nil {
		userId := c.GetInt("id")
		tokenId := c.GetInt("token_id")
		_, _ = fmt.Fprintf(h, "u%d_t%d_", userId, tokenId)
	}

	// Use prefix of prompt text for turn / conversation root affinity
	sample := promptText
	if len(sample) > 256 {
		sample = sample[:256]
	}
	_, _ = h.Write([]byte(sample))
	return fmt.Sprintf("fnv_%x", h.Sum64())
}

type decisionResponse struct {
	SelectedModel string  `json:"selected_model"`
	Confidence    float64 `json:"confidence"`
	Reason        string  `json:"reason"`
}

// QueryDecisionModel asks a System One decision model to pick the optimal model from the candidate list.
func QueryDecisionModel(ctx context.Context, c *gin.Context, combo *model.Combo, promptText string) (string, float64) {
	defaultModel := combo.Models[0]
	decisionModel := ""
	customPrompt := ""
	if combo.Settings != nil {
		decisionModel = combo.Settings.DecisionModel
		customPrompt = combo.Settings.DecisionPrompt
	}
	if decisionModel == "" {
		decisionModel = defaultModel
	}

	routerEngine := RouterProvider
	if routerEngine == nil || routerEngine() == nil || c == nil {
		return defaultModel, 0.5
	}

	systemInstruction := customPrompt
	if systemInstruction == "" {
		systemInstruction = fmt.Sprintf(
			"You are an AI model router. Given the candidate models and the user prompt, select the single most appropriate model. "+
				"Consider reasoning difficulty, task complexity, and speed. "+
				"Available models: %s. "+
				"Respond with ONLY a JSON object: {\"selected_model\": \"<model_name>\", \"confidence\": 0.0-1.0, \"reason\": \"<explanation>\"}",
			strings.Join(combo.Models, ", "),
		)
	}

	samplePrompt := promptText
	if len(samplePrompt) > 1000 {
		samplePrompt = samplePrompt[:1000]
	}

	reqPayload := map[string]any{
		"model": decisionModel,
		"messages": []map[string]string{
			{"role": "system", "content": systemInstruction},
			{"role": "user", "content": samplePrompt},
		},
		"temperature":     0.1,
		"max_tokens":      120,
		"response_format": map[string]string{"type": "json_object"},
	}

	bodyBytes, err := common.Marshal(reqPayload)
	if err != nil {
		return defaultModel, 0.5
	}

	reqCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	subReq := httptest.NewRequestWithContext(reqCtx, http.MethodPost, "/v1/chat/completions", bytes.NewReader(bodyBytes))
	subReq.Header.Set("Content-Type", "application/json")
	if c.Request != nil {
		subReq.Header.Set("Authorization", c.Request.Header.Get("Authorization"))
	}
	subReq.Header.Set("X-Internal-Combo", "true")

	w := httptest.NewRecorder()
	routerEngine().ServeHTTP(w, subReq)

	if w.Code >= 400 {
		logger.LogWarn(c, common.LogText("smart_router decision model returned code %d", w.Code))
		return defaultModel, 0.5
	}

	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := common.Unmarshal(w.Body.Bytes(), &completion); err != nil || len(completion.Choices) == 0 {
		return defaultModel, 0.5
	}

	rawContent := strings.TrimSpace(completion.Choices[0].Message.Content)
	var decision decisionResponse
	if err := common.UnmarshalJsonStr(rawContent, &decision); err != nil {
		return defaultModel, 0.5
	}

	selected := strings.TrimSpace(decision.SelectedModel)
	if slices.Contains(combo.Models, selected) {
		conf := decision.Confidence
		if conf <= 0 {
			conf = 0.8
		}
		return selected, conf
	}

	return defaultModel, 0.5
}

// ResolveSmartRouter selects the optimal model according to the configured Smart Router mode.
func ResolveSmartRouter(ctx context.Context, c *gin.Context, combo *model.Combo, promptText string) string {
	if len(combo.Models) == 0 {
		return ""
	}
	if len(combo.Models) == 1 {
		return combo.Models[0]
	}

	mode := model.ComboSmartModeSmartSwitch
	hysteresis := 0.2
	if combo.Settings != nil {
		if combo.Settings.SmartMode != "" {
			mode = combo.Settings.SmartMode
		}
		if combo.Settings.HysteresisThreshold > 0 {
			hysteresis = combo.Settings.HysteresisThreshold
		}
	}

	sessionKey := fmt.Sprintf("%s_%s", combo.Name, ExtractSessionKey(c, promptText))

	// Clean up expired cache entries periodically
	now := time.Now()

	switch mode {
	case model.ComboSmartModeStrictLock:
		smartRouterSessionLock.RLock()
		entry, found := smartRouterSessionCache[sessionKey]
		smartRouterSessionLock.RUnlock()
		if found && entry.ExpiresAt.After(now) && slices.Contains(combo.Models, entry.Model) {
			// +0ms latency on locked session
			return entry.Model
		}

		selectedModel, conf := QueryDecisionModel(ctx, c, combo, promptText)
		smartRouterSessionLock.Lock()
		smartRouterSessionCache[sessionKey] = smartSessionEntry{
			Model:      selectedModel,
			Confidence: conf,
			ExpiresAt:  now.Add(2 * time.Hour),
		}
		smartRouterSessionLock.Unlock()
		return selectedModel

	case model.ComboSmartModeSmartSwitch:
		smartRouterSessionLock.RLock()
		prevEntry, hasPrev := smartRouterSessionCache[sessionKey]
		smartRouterSessionLock.RUnlock()

		selectedModel, conf := QueryDecisionModel(ctx, c, combo, promptText)

		if hasPrev && prevEntry.ExpiresAt.After(now) && slices.Contains(combo.Models, prevEntry.Model) {
			if prevEntry.Model != selectedModel {
				// Adaptive hysteresis: only switch if confidence gain exceeds threshold
				if conf-prevEntry.Confidence < hysteresis {
					// Keep previous model to preserve prompt cache retention
					return prevEntry.Model
				}
			}
		}

		smartRouterSessionLock.Lock()
		smartRouterSessionCache[sessionKey] = smartSessionEntry{
			Model:      selectedModel,
			Confidence: conf,
			ExpiresAt:  now.Add(2 * time.Hour),
		}
		smartRouterSessionLock.Unlock()
		return selectedModel

	case model.ComboSmartModePerTurn:
		selectedModel, _ := QueryDecisionModel(ctx, c, combo, promptText)
		return selectedModel

	default:
		return combo.Models[0]
	}
}

// GetNextFallbackModel retrieves the next candidate model in a fallback chain.
func GetNextFallbackModel(combo *model.Combo, currentIndex int) (string, int, bool) {
	if currentIndex+1 < len(combo.Models) {
		return combo.Models[currentIndex+1], currentIndex + 1, true
	}
	return "", currentIndex, false
}

// PanelExecutionResult stores the result of one panel model's parallel call in Fusion.
type PanelExecutionResult struct {
	ModelName string
	Content   string
	Error     error
}

// ExecuteFusionParallel executes all models in a fusion combo panel concurrently.
func ExecuteFusionParallel(ctx context.Context, c *gin.Context, combo *model.Combo, originalBody []byte) []PanelExecutionResult {
	models := combo.Models
	results := make([]PanelExecutionResult, len(models))

	routerEngine := RouterProvider
	if routerEngine == nil || routerEngine() == nil {
		for i, m := range models {
			results[i] = PanelExecutionResult{ModelName: m, Error: fmt.Errorf("router engine unavailable")}
		}
		return results
	}

	var wg sync.WaitGroup
	for i, m := range models {
		wg.Add(1)
		go func(index int, modelName string) {
			defer wg.Done()

			// Build request body with this specific panel model
			var reqMap map[string]any
			if err := common.Unmarshal(originalBody, &reqMap); err != nil {
				results[index] = PanelExecutionResult{ModelName: modelName, Error: err}
				return
			}
			reqMap["model"] = modelName
			reqMap["stream"] = false // Panel calls are non-streaming

			newBytes, err := common.Marshal(reqMap)
			if err != nil {
				results[index] = PanelExecutionResult{ModelName: modelName, Error: err}
				return
			}

			subCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
			defer cancel()

			subReq := httptest.NewRequestWithContext(subCtx, http.MethodPost, c.Request.URL.Path, bytes.NewReader(newBytes))
			subReq.Header.Set("Content-Type", "application/json")
			if c.Request != nil {
				subReq.Header.Set("Authorization", c.Request.Header.Get("Authorization"))
			}
			subReq.Header.Set("X-Internal-Combo", "true")

			w := httptest.NewRecorder()
			routerEngine().ServeHTTP(w, subReq)

			if w.Code >= 400 {
				results[index] = PanelExecutionResult{
					ModelName: modelName,
					Error:     fmt.Errorf("panel model %s returned status %d: %s", modelName, w.Code, w.Body.String()),
				}
				return
			}

			var completion struct {
				Choices []struct {
					Message struct {
						Content string `json:"content"`
					} `json:"message"`
				} `json:"choices"`
			}

			if err := common.Unmarshal(w.Body.Bytes(), &completion); err != nil || len(completion.Choices) == 0 {
				results[index] = PanelExecutionResult{
					ModelName: modelName,
					Error:     fmt.Errorf("failed to parse completion from %s: %s", modelName, w.Body.String()),
				}
				return
			}

			results[index] = PanelExecutionResult{
				ModelName: modelName,
				Content:   completion.Choices[0].Message.Content,
			}
		}(i, m)
	}

	wg.Wait()
	return results
}

// BuildFusionSynthesisPrompt creates the judge prompt from user prompt and panel responses.
func BuildFusionSynthesisPrompt(userPrompt string, panelResults []PanelExecutionResult, customPrompt string) string {
	var sb strings.Builder
	systemPrefix := customPrompt
	if systemPrefix == "" {
		systemPrefix = "You are a master synthesis judge. Multiple AI models have answered the user's prompt. " +
			"Analyze their candidate answers, identify unique strengths, resolve factual discrepancies, " +
			"and synthesize a single authoritative, complete, and superior final answer."
	}
	sb.WriteString(systemPrefix)
	sb.WriteString("\n\n=== USER PROMPT ===\n")
	sb.WriteString(userPrompt)
	sb.WriteString("\n\n=== CANDIDATE MODEL RESPONSES ===\n")

	for _, res := range panelResults {
		if res.Error != nil || res.Content == "" {
			continue
		}
		sb.WriteString(fmt.Sprintf("\n--- Response from [%s] ---\n", res.ModelName))
		sb.WriteString(res.Content)
		sb.WriteString("\n")
	}

	sb.WriteString("\n=== END OF CANDIDATE RESPONSES ===\n")
	sb.WriteString("Provide the synthesized final response now. Do not explicitly refer to candidate models unless directly relevant to the user request.")
	return sb.String()
}

// BridgeStreamingWriter bridges an internal streaming response directly to client writer.
type BridgeStreamingWriter struct {
	GinWriter gin.ResponseWriter
	header    http.Header
	Status    int
}

func NewBridgeStreamingWriter(w gin.ResponseWriter) *BridgeStreamingWriter {
	return &BridgeStreamingWriter{
		GinWriter: w,
		header:    make(http.Header),
		Status:    http.StatusOK,
	}
}

func (b *BridgeStreamingWriter) Header() http.Header {
	return b.header
}

func (b *BridgeStreamingWriter) WriteHeader(statusCode int) {
	b.Status = statusCode
	for k, vv := range b.header {
		for _, v := range vv {
			b.GinWriter.Header().Add(k, v)
		}
	}
	b.GinWriter.WriteHeader(statusCode)
}

func (b *BridgeStreamingWriter) Write(p []byte) (int, error) {
	n, err := b.GinWriter.Write(p)
	b.GinWriter.Flush()
	return n, err
}
