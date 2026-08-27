package service

// S3Store uses the MinIO-maintained S3 Signature V4 client. Storage references
// remain internal; callers receive only short-lived, purpose-specific URLs.
import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var ErrObjectTooLarge = errors.New("object exceeds the configured byte limit")

type S3Store struct {
	Endpoint, BrowserUploadEndpoint, Region, Bucket, AccessKey, SecretKey string
	client                                                                *minio.Client
}

func S3FromEnvironment() (*S3Store, error) {
	endpoint := os.Getenv("DW_S3_ENDPOINT")
	s := &S3Store{Endpoint: endpoint, BrowserUploadEndpoint: os.Getenv("DW_S3_BROWSER_UPLOAD_ENDPOINT"), Region: os.Getenv("DW_S3_REGION"), Bucket: os.Getenv("DW_S3_BUCKET"), AccessKey: os.Getenv("DW_S3_ACCESS_KEY"), SecretKey: os.Getenv("DW_S3_SECRET_KEY")}
	if s.Region == "" {
		s.Region = "us-east-1"
	}
	if s.Endpoint == "" || s.Bucket == "" || s.AccessKey == "" || s.SecretKey == "" {
		return nil, fmt.Errorf("DW_S3_ENDPOINT, DW_S3_BUCKET, DW_S3_ACCESS_KEY and DW_S3_SECRET_KEY are required")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("invalid DW_S3_ENDPOINT")
	}
	client, err := minio.New(parsed.Host, &minio.Options{Creds: credentials.NewStaticV4(s.AccessKey, s.SecretKey, ""), Secure: parsed.Scheme == "https", Region: s.Region})
	if err != nil {
		return nil, err
	}
	s.client = client
	return s, nil
}

func (s *S3Store) CreateUpload(ref, _ string, _ int64, expires time.Time) (string, map[string]string, error) {
	u, err := s.client.PresignedPutObject(context.Background(), s.Bucket, ref, time.Until(expires))
	if err != nil {
		return "", nil, err
	}
	if s.BrowserUploadEndpoint == "" {
		return u.String(), map[string]string{}, nil
	}
	browser, err := browserUploadURL(s.BrowserUploadEndpoint, u)
	if err != nil {
		return "", nil, err
	}
	return browser.String(), map[string]string{}, nil
}

// browserUploadURL retains MinIO's signed object path and query exactly, but
// replaces its Docker-only authority with the public same-origin proxy path.
func browserUploadURL(endpoint string, signed *url.URL) (*url.URL, error) {
	base, err := url.Parse(endpoint)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("invalid DW_S3_BROWSER_UPLOAD_ENDPOINT")
	}
	base.Path = strings.TrimRight(base.Path, "/") + signed.Path
	base.RawPath = ""
	base.RawQuery = signed.RawQuery
	return base, nil
}
func (s *S3Store) Stat(ref string) (string, int64, error) {
	return s.StatContext(context.Background(), ref)
}
func (s *S3Store) StatContext(ctx context.Context, ref string) (string, int64, error) {
	info, err := s.client.StatObject(ctx, s.Bucket, ref, minio.StatObjectOptions{})
	return info.ContentType, info.Size, err
}
func (s *S3Store) Read(ref string) ([]byte, error) {
	object, err := s.client.GetObject(context.Background(), s.Bucket, ref, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer object.Close()
	return io.ReadAll(object)
}
func (s *S3Store) ReadPrefix(ref string, limit int64) ([]byte, error) {
	if limit < 0 {
		return nil, fmt.Errorf("prefix limit must be non-negative")
	}
	object, err := s.client.GetObject(context.Background(), s.Bucket, ref, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer object.Close()
	return io.ReadAll(io.LimitReader(object, limit))
}
func (s *S3Store) DownloadTo(ctx context.Context, ref string, destination io.Writer, maxBytes int64) error {
	object, err := s.client.GetObject(ctx, s.Bucket, ref, minio.GetObjectOptions{})
	if err != nil {
		return err
	}
	defer object.Close()
	written, err := io.Copy(destination, io.LimitReader(object, maxBytes+1))
	if err != nil {
		return err
	}
	if written > maxBytes {
		return ErrObjectTooLarge
	}
	return nil
}
func (s *S3Store) SignedURL(ref, _ string, expires time.Time) (string, error) {
	u, err := s.client.PresignedGetObject(context.Background(), s.Bucket, ref, time.Until(expires), nil)
	return u.String(), err
}

// Write is used only by the isolated derivative processor; public requests
// never receive a write URL.
func (s *S3Store) Write(ref, mime string, body []byte) error {
	return s.WriteContext(context.Background(), ref, mime, body)
}
func (s *S3Store) WriteContext(ctx context.Context, ref, mime string, body []byte) error {
	_, err := s.client.PutObject(ctx, s.Bucket, ref, strings.NewReader(string(body)), int64(len(body)), minio.PutObjectOptions{ContentType: mime})
	return err
}
