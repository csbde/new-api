package model

import (
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	ComboStrategyFallback    = "fallback"
	ComboStrategyRoundRobin  = "round_robin"
	ComboStrategySmartRouter = "smart_router"
	ComboStrategyFusion      = "fusion"

	ComboSmartModeSmartSwitch = "smart_switch"
	ComboSmartModeStrictLock  = "strict_lock"
	ComboSmartModePerTurn     = "per_turn"

	ComboStatusEnabled  = 1
	ComboStatusDisabled = 2
)

type ComboStrategySettings struct {
	// For smart_router:
	DecisionModel       string  `json:"decision_model,omitempty"`
	SmartMode           string  `json:"smart_mode,omitempty"` // smart_switch, strict_lock, per_turn
	HysteresisThreshold float64 `json:"hysteresis_threshold,omitempty"`
	DecisionPrompt      string  `json:"decision_prompt,omitempty"`

	// For fusion:
	JudgeModel      string  `json:"judge_model,omitempty"`
	SynthesisPrompt string  `json:"synthesis_prompt,omitempty"`
	Temperature     float64 `json:"temperature,omitempty"`
}

type Combo struct {
	Id           int                    `json:"id" gorm:"primaryKey"`
	Name         string                 `json:"name" gorm:"size:128;not null;uniqueIndex:uk_combo_name_deleted_at,priority:1"`
	Description  string                 `json:"description" gorm:"type:text"`
	Strategy     string                 `json:"strategy" gorm:"size:32;not null"`
	ModelsJSON   string                 `json:"-" gorm:"column:models;type:text;not null"`
	Models       []string               `json:"models" gorm:"-"`
	SettingsJSON string                 `json:"-" gorm:"column:settings;type:text"`
	Settings     *ComboStrategySettings `json:"settings" gorm:"-"`
	Group        string                 `json:"group" gorm:"size:64;default:''"`
	Status       int                    `json:"status" gorm:"default:1"`
	UserId       int                    `json:"user_id" gorm:"default:0;index"`
	CreatedTime  int64                  `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64                  `json:"updated_time" gorm:"bigint"`
	DeletedAt    gorm.DeletedAt         `json:"-" gorm:"index;uniqueIndex:uk_combo_name_deleted_at,priority:2"`
}

func (c *Combo) AfterFind(tx *gorm.DB) error {
	if c.ModelsJSON != "" {
		_ = common.UnmarshalJsonStr(c.ModelsJSON, &c.Models)
	}
	if c.Models == nil {
		c.Models = make([]string, 0)
	}
	if c.SettingsJSON != "" {
		c.Settings = &ComboStrategySettings{}
		_ = common.UnmarshalJsonStr(c.SettingsJSON, c.Settings)
	}
	return nil
}

// GetGroups returns the list of groups this combo is bound to, or empty if available to all groups.
func (c *Combo) GetGroups() []string {
	trimmed := strings.TrimSpace(c.Group)
	if trimmed == "" || trimmed == "all" {
		return []string{}
	}
	parts := strings.Split(trimmed, ",")
	groups := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item != "" {
			groups = append(groups, item)
		}
	}
	return groups
}

// HasGroup reports whether this combo is available for the given group.
func (c *Combo) HasGroup(group string) bool {
	trimmed := strings.TrimSpace(c.Group)
	if trimmed == "" || trimmed == "all" {
		return true
	}
	if group == "" {
		return false
	}
	groups := c.GetGroups()
	return slices.Contains(groups, group)
}

func (c *Combo) BeforeSave(tx *gorm.DB) error {
	if len(c.Models) > 0 {
		data, err := common.Marshal(c.Models)
		if err != nil {
			return err
		}
		c.ModelsJSON = string(data)
	} else {
		c.ModelsJSON = "[]"
	}
	if c.Settings != nil {
		data, err := common.Marshal(c.Settings)
		if err != nil {
			return err
		}
		c.SettingsJSON = string(data)
	} else {
		c.SettingsJSON = "{}"
	}
	now := time.Now().Unix()
	if c.CreatedTime == 0 {
		c.CreatedTime = now
	}
	c.UpdatedTime = now
	return nil
}

func (c *Combo) Validate() error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return errors.New("combo name is required")
	}
	c.Strategy = strings.TrimSpace(c.Strategy)
	switch c.Strategy {
	case ComboStrategyFallback, ComboStrategyRoundRobin, ComboStrategySmartRouter, ComboStrategyFusion:
	default:
		return errors.New("invalid combo strategy: must be fallback, round_robin, smart_router, or fusion")
	}
	if len(c.Models) == 0 {
		return errors.New("combo must include at least one target model")
	}
	for i, m := range c.Models {
		c.Models[i] = strings.TrimSpace(m)
		if c.Models[i] == "" {
			return errors.New("target model name cannot be empty")
		}
	}
	if c.Strategy == ComboStrategySmartRouter && c.Settings != nil {
		switch c.Settings.SmartMode {
		case "", ComboSmartModeSmartSwitch, ComboSmartModeStrictLock, ComboSmartModePerTurn:
		default:
			return errors.New("invalid smart mode: must be smart_switch, strict_lock, or per_turn")
		}
		if c.Settings.SmartMode == "" {
			c.Settings.SmartMode = ComboSmartModeSmartSwitch
		}
		if c.Settings.HysteresisThreshold <= 0 {
			c.Settings.HysteresisThreshold = 0.2
		}
	}
	if c.Strategy == ComboStrategyFusion && c.Settings != nil {
		if c.Settings.JudgeModel == "" && len(c.Models) > 0 {
			c.Settings.JudgeModel = c.Models[0]
		}
	}
	return nil
}

func GetAllCombos(page int, pageSize int, keyword string, strategy string, status int) ([]*Combo, int64, error) {
	var combos []*Combo
	var total int64
	tx := DB.Model(&Combo{})
	if keyword != "" {
		tx = tx.Where("name LIKE ? OR description LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	if strategy != "" {
		tx = tx.Where("strategy = ?", strategy)
	}
	if status > 0 {
		tx = tx.Where("status = ?", status)
	}
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if pageSize > 0 {
		offset := (page - 1) * pageSize
		tx = tx.Offset(offset).Limit(pageSize)
	}
	err := tx.Order("id desc").Find(&combos).Error
	return combos, total, err
}

func GetAllEnabledCombos() ([]*Combo, error) {
	var combos []*Combo
	err := DB.Where("status = ?", ComboStatusEnabled).Find(&combos).Error
	return combos, err
}

func GetComboById(id int) (*Combo, error) {
	var combo Combo
	err := DB.Where("id = ?", id).First(&combo).Error
	return &combo, err
}

func GetComboByName(name string) (*Combo, error) {
	var combo Combo
	err := DB.Where("name = ?", name).First(&combo).Error
	return &combo, err
}

func (c *Combo) Insert() error {
	if err := c.Validate(); err != nil {
		return err
	}
	return DB.Create(c).Error
}

func (c *Combo) Update() error {
	if err := c.Validate(); err != nil {
		return err
	}
	return DB.Save(c).Error
}

func DeleteComboById(id int) error {
	return DB.Where("id = ?", id).Delete(&Combo{}).Error
}
