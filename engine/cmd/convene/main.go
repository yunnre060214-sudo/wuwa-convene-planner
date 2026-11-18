package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/yunnre060214-sudo/wuwa-convene-planner/engine/internal/convene"
)

func run() error {
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 512*1024))
	decoder.DisallowUnknownFields()
	var config convene.Config
	if err := decoder.Decode(&config); err != nil {
		return fmt.Errorf("输入配置格式无效：%w", err)
	}
	out := json.NewEncoder(os.Stdout)
	result, err := convene.Calculate(config, func(progress convene.Progress) {
		_ = out.Encode(map[string]any{"progress": progress})
	})
	if err != nil {
		return err
	}
	return out.Encode(map[string]any{"result": result})
}

func main() {
	if err := run(); err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"error": err.Error()})
		os.Exit(1)
	}
}
