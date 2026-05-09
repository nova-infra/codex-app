package runtime

import (
	"fmt"
	"os"
	"sort"
	"strings"
)

var requiredChannelEnv = map[string][]string{
	"telegram": {"TELEGRAM_BOT_TOKEN"},
	"wechat":   {"WEIXIN_CORP_ID", "WEIXIN_CORP_SECRET", "WEIXIN_AGENT_ID"},
	"lark":     {"LARK_APP_ID", "LARK_APP_SECRET"},
}

func ChannelCredentialChecks(channels []string) []CheckResult {
	names := append([]string(nil), channels...)
	sort.Strings(names)
	checks := make([]CheckResult, 0, len(names))
	for _, ch := range names {
		missing := MissingChannelEnv(ch)
		name := "channel." + ch
		if len(missing) == 0 {
			checks = append(checks, CheckResult{Name: name, Status: CheckOK, Detail: "credentials present"})
			continue
		}
		checks = append(checks, CheckResult{Name: name, Status: CheckWarn, Detail: "missing env: " + strings.Join(missing, ",")})
	}
	return checks
}

func MissingChannelEnv(channel string) []string {
	required := requiredChannelEnv[channel]
	missing := []string{}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			missing = append(missing, key)
		}
	}
	return missing
}

func MissingChannelEnvError(channels []string) error {
	messages := []string{}
	for _, ch := range channels {
		missing := MissingChannelEnv(ch)
		if len(missing) > 0 {
			messages = append(messages, fmt.Sprintf("%s=%s", ch, strings.Join(missing, ",")))
		}
	}
	if len(messages) == 0 {
		return nil
	}
	sort.Strings(messages)
	return fmt.Errorf("missing channel credentials: %s", strings.Join(messages, "; "))
}
