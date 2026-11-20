package controller

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetAllCombos lists all combos with pagination and filtering.
func GetAllCombos(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageSize <= 0 {
		pageSize = 20
	}
	keyword := strings.TrimSpace(c.Query("keyword"))
	strategy := strings.TrimSpace(c.Query("strategy"))
	status, _ := strconv.Atoi(c.DefaultQuery("status", "0"))

	combos, total, err := model.GetAllCombos(page, pageSize, keyword, strategy, status)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": combos,
			"total": total,
			"page":  page,
			"size":  pageSize,
		},
	})
}

// GetCombo returns a single combo by ID.
func GetCombo(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid combo id"})
		return
	}

	combo, err := model.GetComboById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "combo not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    combo,
	})
}

// CreateCombo creates a new model combo.
func CreateCombo(c *gin.Context) {
	var combo model.Combo
	if err := common.DecodeJson(c.Request.Body, &combo); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid request body: " + err.Error()})
		return
	}

	combo.UserId = c.GetInt("id")
	if err := combo.Insert(); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	_ = service.ReloadCombos()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "combo created successfully",
		"data":    combo,
	})
}

// UpdateCombo updates an existing combo.
func UpdateCombo(c *gin.Context) {
	var req model.Combo
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid request body: " + err.Error()})
		return
	}

	if req.Id <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "combo id is required"})
		return
	}

	existing, err := model.GetComboById(req.Id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "combo not found"})
		return
	}

	existing.Name = req.Name
	existing.Description = req.Description
	existing.Strategy = req.Strategy
	existing.Models = req.Models
	existing.Settings = req.Settings
	existing.Group = req.Group
	existing.Status = req.Status

	if err := existing.Update(); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	_ = service.ReloadCombos()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "combo updated successfully",
		"data":    existing,
	})
}

// DeleteCombo deletes a combo by ID.
func DeleteCombo(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid combo id"})
		return
	}

	if err := model.DeleteComboById(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	_ = service.ReloadCombos()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "combo deleted successfully",
	})
}

// ToggleComboStatus toggles or updates a combo's active status.
func ToggleComboStatus(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid combo id"})
		return
	}

	combo, err := model.GetComboById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "combo not found"})
		return
	}

	var body struct {
		Status int `json:"status"`
	}
	if err := common.DecodeJson(c.Request.Body, &body); err == nil && body.Status > 0 {
		combo.Status = body.Status
	} else {
		if combo.Status == model.ComboStatusEnabled {
			combo.Status = model.ComboStatusDisabled
		} else {
			combo.Status = model.ComboStatusEnabled
		}
	}

	if err := combo.Update(); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	_ = service.ReloadCombos()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "status updated",
		"data":    combo.Status,
	})
}

// RelayFusion executes a fusion combo: runs panel models in parallel, then has a judge model synthesize one final answer.
func RelayFusion(c *gin.Context, format types.RelayFormat, combo *model.Combo) {
	bodyStorage, err := common.GetBodyStorage(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body: " + err.Error()})
		return
	}

	rawBytes, err := bodyStorage.Bytes()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body bytes"})
		return
	}

	// Parse general request to determine stream and prompt
	var reqMap map[string]any
	if err := common.Unmarshal(rawBytes, &reqMap); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json body"})
		return
	}

	isStream := false
	if s, ok := reqMap["stream"].(bool); ok {
		isStream = s
	}

	// Extract prompt text
	var userPrompt string
	if msgs, ok := reqMap["messages"].([]any); ok && len(msgs) > 0 {
		var parts []string
		for _, m := range msgs {
			if mObj, ok := m.(map[string]any); ok {
				role := mObj["role"]
				content := mObj["content"]
				parts = append(parts, fmt.Sprintf("%v: %v", role, content))
			}
		}
		userPrompt = strings.Join(parts, "\n")
	} else if p, ok := reqMap["prompt"].(string); ok {
		userPrompt = p
	}

	// 1. Run all panel models in parallel
	logger.LogInfo(c, common.LogText("fusion combo %s: executing %d panel models in parallel", combo.Name, len(combo.Models)))
	results := service.ExecuteFusionParallel(c.Request.Context(), c, combo, rawBytes)

	// Check if at least one panel model succeeded
	successCount := 0
	for _, res := range results {
		if res.Error == nil && res.Content != "" {
			successCount++
		} else if res.Error != nil {
			logger.LogWarn(c, common.LogText("fusion panel model %s failed: %s", res.ModelName, res.Error.Error()))
		}
	}

	if successCount == 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": gin.H{
				"message": "all fusion panel models failed to produce a response",
				"type":    "fusion_panel_failure",
			},
		})
		return
	}

	// 2. Prepare judge call
	judgeModel := ""
	customPrompt := ""
	temperature := 0.7
	if combo.Settings != nil {
		judgeModel = combo.Settings.JudgeModel
		customPrompt = combo.Settings.SynthesisPrompt
		if combo.Settings.Temperature > 0 {
			temperature = combo.Settings.Temperature
		}
	}
	if judgeModel == "" && len(combo.Models) > 0 {
		judgeModel = combo.Models[0]
	}

	synthesisPrompt := service.BuildFusionSynthesisPrompt(userPrompt, results, customPrompt)

	judgeMessages := []map[string]string{
		{"role": "system", "content": synthesisPrompt},
		{"role": "user", "content": "Please deliver the synthesized final response based on the above guidelines."},
	}

	reqMap["model"] = judgeModel
	reqMap["messages"] = judgeMessages
	reqMap["stream"] = isStream
	reqMap["temperature"] = temperature
	delete(reqMap, "prompt")

	judgeBytes, err := common.Marshal(reqMap)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build judge request"})
		return
	}

	routerEngine := service.RouterProvider
	if routerEngine == nil || routerEngine() == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "router engine unavailable for judge synthesis"})
		return
	}

	logger.LogInfo(c, common.LogText("fusion combo %s: running judge model %s (stream=%v)", combo.Name, judgeModel, isStream))

	judgeReq := httptest.NewRequestWithContext(c.Request.Context(), http.MethodPost, c.Request.URL.Path, bytes.NewReader(judgeBytes))
	judgeReq.Header.Set("Content-Type", "application/json")
	if c.Request != nil {
		judgeReq.Header.Set("Authorization", c.Request.Header.Get("Authorization"))
	}
	judgeReq.Header.Set("X-Internal-Combo", "true")

	if isStream {
		// Set streaming headers
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("Connection", "keep-alive")
		c.Writer.Header().Set("Transfer-Encoding", "chunked")

		bridgeWriter := service.NewBridgeStreamingWriter(c.Writer)
		routerEngine().ServeHTTP(bridgeWriter, judgeReq)
		return
	}

	// Non-streaming
	recorder := httptest.NewRecorder()
	routerEngine().ServeHTTP(recorder, judgeReq)

	for k, vv := range recorder.Header() {
		for _, v := range vv {
			c.Writer.Header().Add(k, v)
		}
	}
	c.Writer.WriteHeader(recorder.Code)
	_, _ = io.Copy(c.Writer, recorder.Body)
}
