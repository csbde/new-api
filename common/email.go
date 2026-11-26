package common

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/mail"
	"net/smtp"
	"slices"
	"strconv"
	"strings"
	"time"
)

type EmailConfig struct {
	Provider               string
	SMTPServer             string
	SMTPPort               int
	SMTPAccount            string
	SMTPFrom               string
	SMTPToken              string
	SMTPSSLEnabled         bool
	SMTPStartTLSEnabled    bool
	SMTPInsecureSkipVerify bool
	SMTPForceAuthLogin     bool
	ResendApiKey           string
	ResendFrom             string
}

func GetCurrentEmailConfig() EmailConfig {
	OptionMapRWMutex.RLock()
	provider := OptionMap["EmailProvider"]
	resendKey := OptionMap["ResendApiKey"]
	resendFrom := OptionMap["ResendFrom"]
	server := SMTPServer
	if server == "" && OptionMap["SMTPServer"] != "" {
		server = OptionMap["SMTPServer"]
	}
	port := SMTPPort
	if port == 0 && OptionMap["SMTPPort"] != "" {
		port, _ = strconv.Atoi(OptionMap["SMTPPort"])
	}
	account := SMTPAccount
	if account == "" && OptionMap["SMTPAccount"] != "" {
		account = OptionMap["SMTPAccount"]
	}
	from := SMTPFrom
	if from == "" && OptionMap["SMTPFrom"] != "" {
		from = OptionMap["SMTPFrom"]
	}
	token := SMTPToken
	if token == "" && OptionMap["SMTPToken"] != "" {
		token = OptionMap["SMTPToken"]
	}
	sslEnabled := SMTPSSLEnabled
	if val, ok := OptionMap["SMTPSSLEnabled"]; ok && val != "" {
		sslEnabled = val == "true"
	}
	startTLSEnabled := SMTPStartTLSEnabled
	if val, ok := OptionMap["SMTPStartTLSEnabled"]; ok && val != "" {
		startTLSEnabled = val == "true"
	}
	insecureSkipVerify := SMTPInsecureSkipVerify
	if val, ok := OptionMap["SMTPInsecureSkipVerify"]; ok && val != "" {
		insecureSkipVerify = val == "true"
	}
	forceAuthLogin := SMTPForceAuthLogin
	if val, ok := OptionMap["SMTPForceAuthLogin"]; ok && val != "" {
		forceAuthLogin = val == "true"
	}
	OptionMapRWMutex.RUnlock()

	return EmailConfig{
		Provider:               provider,
		SMTPServer:             server,
		SMTPPort:               port,
		SMTPAccount:            account,
		SMTPFrom:               from,
		SMTPToken:              token,
		SMTPSSLEnabled:         sslEnabled,
		SMTPStartTLSEnabled:    startTLSEnabled,
		SMTPInsecureSkipVerify: insecureSkipVerify,
		SMTPForceAuthLogin:     forceAuthLogin,
		ResendApiKey:           resendKey,
		ResendFrom:             resendFrom,
	}
}

func generateMessageIDForFrom(from string) (string, error) {
	addr := from
	if parsed, err := mail.ParseAddress(from); err == nil && parsed.Address != "" {
		addr = parsed.Address
	}
	split := strings.Split(addr, "@")
	if len(split) < 2 {
		return "", fmt.Errorf("invalid SMTP account")
	}
	domain := split[1]
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), GetRandomString(12), domain), nil
}

func generateMessageID() (string, error) {
	from := SMTPFrom
	if from == "" {
		from = SMTPAccount
	}
	return generateMessageIDForFrom(from)
}

func shouldUseSMTPLoginAuth() bool {
	if SMTPForceAuthLogin {
		return true
	}
	return isOutlookServer(SMTPAccount) || slices.Contains(EmailLoginAuthServerList, SMTPServer)
}

func getSMTPAuth() smtp.Auth {
	return AutoSMTPAuth(SMTPAccount, SMTPToken)
}

func shouldAuthenticateSMTP() bool {
	return SMTPAccount != "" && SMTPToken != ""
}

func smtpTLSConfig() *tls.Config {
	return &tls.Config{
		ServerName:         SMTPServer,
		InsecureSkipVerify: SMTPInsecureSkipVerify, // #nosec G402 -- admin-controlled SMTP compatibility option.
	}
}

func newSMTPClientWithConfigAddr(cfg EmailConfig, addr string) (*smtp.Client, error) {
	tlsConfig := &tls.Config{
		ServerName:         cfg.SMTPServer,
		InsecureSkipVerify: cfg.SMTPInsecureSkipVerify, // #nosec G402 -- admin-controlled SMTP compatibility option.
	}
	if cfg.SMTPSSLEnabled || (cfg.SMTPPort == 465 && !cfg.SMTPStartTLSEnabled) {
		conn, err := tls.Dial("tcp", addr, tlsConfig)
		if err != nil {
			return nil, err
		}
		client, err := smtp.NewClient(conn, cfg.SMTPServer)
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		return client, nil
	}

	client, err := smtp.Dial(addr)
	if err != nil {
		return nil, err
	}

	if cfg.SMTPStartTLSEnabled {
		startTLSSupported, _ := client.Extension("STARTTLS")
		if !startTLSSupported {
			_ = client.Close()
			return nil, fmt.Errorf("SMTP server does not support STARTTLS")
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			_ = client.Close()
			return nil, err
		}
	}

	return client, nil
}

func newSMTPClient(addr string) (*smtp.Client, error) {
	return newSMTPClientWithConfigAddr(GetCurrentEmailConfig(), addr)
}

func SendEmailWithConfig(cfg EmailConfig, subject string, receiver string, content string) error {
	// One selector controls delivery. Never fall back to a second provider:
	// a failed response does not prove that the first provider did not send.
	switch cfg.Provider {
	case "resend":
		return sendResendEmail(cfg.ResendApiKey, cfg.ResendFrom, subject, receiver, content)
	case "", "smtp": // Preserve existing installations without a selector.
	default:
		return NewMessage("Email sending method must be SMTP or Resend")
	}
	from := cfg.SMTPFrom
	if from == "" { // for compatibility
		from = cfg.SMTPAccount
	}
	id, err2 := generateMessageIDForFrom(from)
	if err2 != nil {
		return err2
	}
	if cfg.SMTPServer == "" && cfg.SMTPAccount == "" {
		return NewMessage("SMTP server is not configured")
	}
	encodedSubject := fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(subject)))
	mailContent := []byte(fmt.Sprintf("To: %s\r\n"+
		"From: %s <%s>\r\n"+
		"Subject: %s\r\n"+
		"Date: %s\r\n"+
		"Message-ID: %s\r\n"+ // 添加 Message-ID 头
		"Content-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n",
		receiver, SystemName, from, encodedSubject, time.Now().Format(time.RFC1123Z), id, content))
	auth := AutoSMTPAuthWithConfig(cfg.SMTPAccount, cfg.SMTPToken, cfg.SMTPServer, cfg.SMTPForceAuthLogin)
	addr := fmt.Sprintf("%s:%d", cfg.SMTPServer, cfg.SMTPPort)
	to := strings.Split(receiver, ";")
	client, err := newSMTPClientWithConfigAddr(cfg, addr)
	if err != nil {
		return err
	}
	defer client.Close()
	if cfg.SMTPAccount != "" && cfg.SMTPToken != "" {
		if err = client.Auth(auth); err != nil {
			return err
		}
	}
	if err = client.Mail(from); err != nil {
		return err
	}
	for _, rec := range to {
		if err = client.Rcpt(rec); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	_, err = w.Write(mailContent)
	if err != nil {
		return err
	}
	err = w.Close()
	if err != nil {
		return err
	}
	if err = client.Quit(); err != nil {
		// Some SMTP servers close the connection immediately after accepting DATA (250 OK)
		// without replying to QUIT; the message has already been accepted.
		SysLog(LogText("SMTP QUIT failed after message accepted for %s: %v", receiver, err))
	}
	return nil
}

func SendEmail(subject string, receiver string, content string) error {
	return SendEmailWithConfig(GetCurrentEmailConfig(), subject, receiver, content)
}
