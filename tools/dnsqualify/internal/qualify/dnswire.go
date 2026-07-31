package qualify

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
)

const (
	qTypeA     uint16 = 1
	qTypeCNAME uint16 = 5
	qTypeAAAA  uint16 = 28
	qTypeHTTPS uint16 = 65
)

type dnsResponse struct {
	ID        uint16
	RCode     int
	Truncated bool
	Answers   []string
	TTLs      []uint32
}

func buildQuery(domain string, qtype uint16) ([]byte, uint16, error) {
	domain = strings.TrimSuffix(strings.TrimSpace(domain), ".")
	if domain == "" {
		return nil, 0, errors.New("DNS query domain is required")
	}
	idBytes := make([]byte, 2)
	if _, err := rand.Read(idBytes); err != nil {
		return nil, 0, fmt.Errorf("generate DNS query id: %w", err)
	}
	id := binary.BigEndian.Uint16(idBytes)
	msg := make([]byte, 12, 512)
	binary.BigEndian.PutUint16(msg[0:2], id)
	binary.BigEndian.PutUint16(msg[2:4], 0x0100)
	binary.BigEndian.PutUint16(msg[4:6], 1)
	for _, label := range strings.Split(domain, ".") {
		if len(label) == 0 || len(label) > 63 {
			return nil, 0, fmt.Errorf("invalid DNS label in %q", domain)
		}
		msg = append(msg, byte(len(label)))
		msg = append(msg, label...)
	}
	msg = append(msg, 0, byte(qtype>>8), byte(qtype), 0, 1)
	return msg, id, nil
}

func parseResponse(msg []byte, expectedID uint16) (dnsResponse, error) {
	if len(msg) < 12 {
		return dnsResponse{}, errors.New("DNS response shorter than header")
	}
	id := binary.BigEndian.Uint16(msg[0:2])
	if id != expectedID {
		return dnsResponse{}, fmt.Errorf("DNS response id %d does not match query id %d", id, expectedID)
	}
	flags := binary.BigEndian.Uint16(msg[2:4])
	if flags&0x8000 == 0 {
		return dnsResponse{}, errors.New("DNS response is missing QR flag")
	}
	qdCount := int(binary.BigEndian.Uint16(msg[4:6]))
	anCount := int(binary.BigEndian.Uint16(msg[6:8]))
	offset := 12
	var err error
	for i := 0; i < qdCount; i++ {
		offset, err = skipName(msg, offset)
		if err != nil {
			return dnsResponse{}, fmt.Errorf("parse DNS question name: %w", err)
		}
		if offset+4 > len(msg) {
			return dnsResponse{}, errors.New("DNS question exceeds response")
		}
		offset += 4
	}
	result := dnsResponse{
		ID:        id,
		RCode:     int(flags & 0x000f),
		Truncated: flags&0x0200 != 0,
	}
	for i := 0; i < anCount; i++ {
		offset, err = skipName(msg, offset)
		if err != nil {
			return dnsResponse{}, fmt.Errorf("parse DNS answer name: %w", err)
		}
		if offset+10 > len(msg) {
			return dnsResponse{}, errors.New("DNS answer header exceeds response")
		}
		rrType := binary.BigEndian.Uint16(msg[offset : offset+2])
		ttl := binary.BigEndian.Uint32(msg[offset+4 : offset+8])
		rdLength := int(binary.BigEndian.Uint16(msg[offset+8 : offset+10]))
		rdataOffset := offset + 10
		if rdataOffset+rdLength > len(msg) {
			return dnsResponse{}, errors.New("DNS answer data exceeds response")
		}
		switch rrType {
		case qTypeA:
			if rdLength == net.IPv4len {
				result.Answers = append(result.Answers, net.IP(msg[rdataOffset:rdataOffset+rdLength]).String())
				result.TTLs = append(result.TTLs, ttl)
			}
		case qTypeAAAA:
			if rdLength == net.IPv6len {
				result.Answers = append(result.Answers, net.IP(msg[rdataOffset:rdataOffset+rdLength]).String())
				result.TTLs = append(result.TTLs, ttl)
			}
		case qTypeCNAME:
			name, nameErr := readName(msg, rdataOffset, map[int]bool{})
			if nameErr != nil {
				return dnsResponse{}, fmt.Errorf("parse CNAME answer: %w", nameErr)
			}
			result.Answers = append(result.Answers, "CNAME:"+name)
			result.TTLs = append(result.TTLs, ttl)
		case qTypeHTTPS:
			result.Answers = append(result.Answers, fmt.Sprintf("HTTPS:rdata=%d", rdLength))
			result.TTLs = append(result.TTLs, ttl)
		}
		offset = rdataOffset + rdLength
	}
	result.Answers = uniqueSorted(result.Answers)
	sort.Slice(result.TTLs, func(i, j int) bool { return result.TTLs[i] < result.TTLs[j] })
	return result, nil
}

func skipName(msg []byte, offset int) (int, error) {
	if offset < 0 || offset >= len(msg) {
		return 0, errors.New("DNS name offset is outside response")
	}
	for {
		if offset >= len(msg) {
			return 0, errors.New("DNS name exceeds response")
		}
		length := int(msg[offset])
		if length == 0 {
			return offset + 1, nil
		}
		if length&0xc0 == 0xc0 {
			if offset+1 >= len(msg) {
				return 0, errors.New("DNS compression pointer exceeds response")
			}
			return offset + 2, nil
		}
		if length > 63 || offset+1+length > len(msg) {
			return 0, errors.New("invalid DNS label length")
		}
		offset += 1 + length
	}
}

func readName(msg []byte, offset int, visited map[int]bool) (string, error) {
	if offset < 0 || offset >= len(msg) {
		return "", errors.New("DNS name offset is outside response")
	}
	if visited[offset] {
		return "", errors.New("DNS compression pointer cycle")
	}
	visited[offset] = true
	labels := []string{}
	for {
		if offset >= len(msg) {
			return "", errors.New("DNS name exceeds response")
		}
		length := int(msg[offset])
		if length == 0 {
			return strings.Join(labels, "."), nil
		}
		if length&0xc0 == 0xc0 {
			if offset+1 >= len(msg) {
				return "", errors.New("DNS compression pointer exceeds response")
			}
			pointer := (length&0x3f)<<8 | int(msg[offset+1])
			suffix, err := readName(msg, pointer, visited)
			if err != nil {
				return "", err
			}
			if suffix != "" {
				labels = append(labels, suffix)
			}
			return strings.Join(labels, "."), nil
		}
		if length > 63 || offset+1+length > len(msg) {
			return "", errors.New("invalid DNS label length")
		}
		labels = append(labels, string(msg[offset+1:offset+1+length]))
		offset += 1 + length
	}
}

func uniqueSorted(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]bool{}
	for _, value := range values {
		seen[value] = true
	}
	result := make([]string, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
