package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

func registerComboRoutes(apiRouter *gin.RouterGroup) {
	comboRoute := apiRouter.Group("/combo")
	comboRoute.Use(middleware.AdminAuth())
	{
		comboRoute.GET("/", controller.GetAllCombos)
		comboRoute.GET("/:id", controller.GetCombo)
		comboRoute.POST("/", controller.CreateCombo)
		comboRoute.PUT("/", controller.UpdateCombo)
		comboRoute.DELETE("/:id", controller.DeleteCombo)
		comboRoute.POST("/:id/status", controller.ToggleComboStatus)
	}
}
