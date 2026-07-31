package wandns

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiscoverPreservesInterfaceProvenance(t *testing.T) {
	path := filepath.Join(t.TempDir(), "resolv.conf.auto")
	if err := os.WriteFile(path, []byte("# Interface wan\nnameserver 202.96.134.133\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := Discover(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Address != "202.96.134.133" || got[0].Interface != "wan" {
		t.Fatalf("resolvers = %+v", got)
	}
}

func TestDiscoverRejectsInvalidResolver(t *testing.T) {
	path := filepath.Join(t.TempDir(), "resolv.conf.auto")
	if err := os.WriteFile(path, []byte("nameserver 127.0.0.1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Discover(path); err == nil || !strings.Contains(err.Error(), "invalid WAN nameserver") {
		t.Fatalf("Discover error = %v", err)
	}
}
