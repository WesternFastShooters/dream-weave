package domain

import "time"

type ObjectStore interface {
	CreateUpload(string, string, int64, time.Time) (url string, headers map[string]string, err error)
	Stat(string) (mime string, size int64, err error)
	Read(string) ([]byte, error)
	ReadPrefix(string, int64) ([]byte, error)
	SignedURL(string, string, time.Time) (string, error)
}
type UploadTicket struct {
	UploadID        string
	UploadURL       string
	Method          string
	RequiredHeaders map[string]string
	ExpiresAt       string
}
type Asset struct {
	ID              string
	ProjectID       string
	Kind            string
	DisplayName     string
	ProcessingState string
}
type Access struct {
	URL       string
	ExpiresAt string
	FileName  string
}
type UploadRecord struct {
	ID, ProjectID, StorageRef, FileName, DeclaredMIME string
	DeclaredBytes                                     int64
	ExpiresAt                                         time.Time
	CompletedAt                                       *time.Time
}
