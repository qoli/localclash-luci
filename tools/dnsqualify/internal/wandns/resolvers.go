package wandns

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"strings"
)

const DefaultResolvPath = "/tmp/resolv.conf.d/resolv.conf.auto"

type Resolver struct {
	Address   string `json:"address"`
	Interface string `json:"interface"`
}

func Discover(path string) ([]Resolver, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		path = DefaultResolvPath
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read WAN resolver provenance %s: %w", path, err)
	}
	defer file.Close()

	currentInterface := ""
	resolvers := []Resolver{}
	seen := map[string]bool{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "# Interface ") {
			currentInterface = strings.TrimSpace(strings.TrimPrefix(line, "# Interface "))
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 || fields[0] != "nameserver" {
			continue
		}
		ip := net.ParseIP(fields[1])
		if ip == nil || ip.IsUnspecified() || ip.IsLoopback() || ip.IsMulticast() || ip.IsLinkLocalUnicast() {
			return nil, fmt.Errorf("invalid WAN nameserver %q in %s", fields[1], path)
		}
		key := currentInterface + "|" + ip.String()
		if seen[key] {
			continue
		}
		seen[key] = true
		resolvers = append(resolvers, Resolver{Address: ip.String(), Interface: currentInterface})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan WAN resolver provenance %s: %w", path, err)
	}
	if len(resolvers) == 0 {
		return nil, fmt.Errorf("no WAN-interface nameservers found in %s", path)
	}
	return resolvers, nil
}
