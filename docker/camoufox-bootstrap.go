// Shell-free Camoufox installer for the distroless Docker image: it extracts
// the baked-in camoufox.zip into the install directory with no network at
// container start. It mirrors src/lib/camoufox/packageManager.ts (the runtime
// installer used outside Docker). Both read the committed dependencies.json
// for the target version (.camoufox.linux[<arch>].version = "vX.Y.Z-release");
// keep that parsing in lockstep. (version.json is the generated install
// marker, written by install() below.)
//
// Why this runs at container START instead of just unzipping in the Dockerfile:
// CAMOUFOX_INSTALL_DIR (/var/tmp/youtubei.js/camoufox) lives inside the rw
// bind-mounted volume declared in docker-compose.yaml, and the container runs
// with `read_only: true`. So:
//   - Unzipping into that path at build time is useless: the runtime bind mount
//     shadows the image layer, and bind mounts (unlike named volumes) are never
//     seeded from the image, so the path is empty/host-provided at runtime.
//   - The volume is the only writable location (read-only rootfs), so the
//     browser can only be materialized at runtime, into the volume.
//
// This binary also creates the writable scratch dirs (home/tmp/xdg-cache/
// xdg-data) the empty volume lacks, and re-extracts on a version.json mismatch.
// Alternative (not chosen): bake the unzipped browser into a non-volume image
// path (e.g. /opt/camoufox, read-only is fine since Firefox writes only to its
// profile) and move the scratch-dir mkdirs into the app — at the cost of a
// larger image and losing the persistent-volume browser cache.
package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

const (
	archivePath      = "/usr/share/invidious-companion/camoufox.zip"
	dependenciesPath = "/app/dependencies.json"
	storageRoot      = "/var/tmp/youtubei.js"
)

type version struct {
	Version string `json:"version"`
	Release string `json:"release"`
}

type dependencies struct {
	Camoufox struct {
		Linux map[string]struct {
			Version string `json:"version"`
		} `json:"linux"`
	} `json:"camoufox"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "camoufox bootstrap: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if err := prepareBrowser(); err != nil {
		fmt.Fprintf(os.Stderr, "camoufox bootstrap warning: %v; Companion will use its fallback if needed\n", err)
	}
	if len(os.Args) < 2 {
		return fmt.Errorf("no application command was provided")
	}
	return syscall.Exec(os.Args[1], os.Args[1:], os.Environ())
}

func prepareBrowser() error {
	installDir := os.Getenv("CAMOUFOX_INSTALL_DIR")
	if installDir == "" {
		installDir = filepath.Join(storageRoot, "camoufox")
	}
	installDir = filepath.Clean(installDir)
	if !strings.HasPrefix(installDir, storageRoot+string(filepath.Separator)) {
		return fmt.Errorf("CAMOUFOX_INSTALL_DIR must be inside %s", storageRoot)
	}

	wanted, err := configuredVersion()
	if err != nil {
		return err
	}

	for _, directory := range []string{
		filepath.Join(storageRoot, "home"),
		filepath.Join(storageRoot, "tmp"),
		filepath.Join(storageRoot, "xdg-cache"),
		filepath.Join(storageRoot, "xdg-data"),
	} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return err
		}
	}

	if !isInstalled(installDir, wanted) {
		fmt.Printf("Installing Camoufox %s-%s into %s\n", wanted.Version, wanted.Release, installDir)
		if err := install(installDir, wanted); err != nil {
			return err
		}
	}

	return nil
}

func configuredVersion() (version, error) {
	architecture := map[string]string{"amd64": "x86_64", "arm64": "arm64"}[runtime.GOARCH]
	if architecture == "" {
		return version{}, fmt.Errorf("unsupported Camoufox architecture %s", runtime.GOARCH)
	}
	data, err := os.ReadFile(dependenciesPath)
	if err != nil {
		return version{}, fmt.Errorf("read dependencies: %w", err)
	}
	var configured dependencies
	if err := json.Unmarshal(data, &configured); err != nil {
		return version{}, fmt.Errorf("parse dependencies: %w", err)
	}
	tag := configured.Camoufox.Linux[architecture].Version
	parts := strings.SplitN(strings.TrimPrefix(tag, "v"), "-", 2)
	if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
		return version{Version: parts[0], Release: parts[1]}, nil
	}
	return version{}, fmt.Errorf("invalid Camoufox version for %s", architecture)
}

func isInstalled(installDir string, wanted version) bool {
	binary, err := os.Stat(filepath.Join(installDir, "camoufox-bin"))
	if err != nil || binary.Mode()&0o111 == 0 {
		return false
	}
	data, err := os.ReadFile(filepath.Join(installDir, "version.json"))
	if err != nil {
		return false
	}
	var current version
	return json.Unmarshal(data, &current) == nil && current == wanted
}

func install(installDir string, wanted version) error {
	// Keep this layout and version.json shape aligned with
	// src/lib/camoufox/packageManager.ts.
	temporaryDir := fmt.Sprintf("%s.tmp.%d", installDir, os.Getpid())
	if err := os.RemoveAll(temporaryDir); err != nil {
		return err
	}
	defer os.RemoveAll(temporaryDir)
	if err := os.MkdirAll(temporaryDir, 0o755); err != nil {
		return err
	}
	if err := extractZip(archivePath, temporaryDir); err != nil {
		return err
	}
	for _, binary := range []string{"camoufox", "camoufox-bin"} {
		if err := os.Chmod(filepath.Join(temporaryDir, binary), 0o755); err != nil {
			return err
		}
	}
	data, err := json.Marshal(wanted)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(temporaryDir, "version.json"), append(data, '\n'), 0o644); err != nil {
		return err
	}
	if err := os.RemoveAll(installDir); err != nil {
		return err
	}
	return os.Rename(temporaryDir, installDir)
}

func extractZip(archivePath, destination string) error {
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer archive.Close()

	for _, entry := range archive.File {
		target := filepath.Join(destination, filepath.FromSlash(entry.Name))
		relative, err := filepath.Rel(destination, target)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return fmt.Errorf("unsafe archive path %q", entry.Name)
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := extractFile(entry, target); err != nil {
			return err
		}
	}
	return nil
}

func extractFile(entry *zip.File, target string) error {
	source, err := entry.Open()
	if err != nil {
		return err
	}
	defer source.Close()

	mode := entry.Mode().Perm()
	if mode == 0 {
		mode = 0o644
	}
	destination, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(destination, source)
	closeErr := destination.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
