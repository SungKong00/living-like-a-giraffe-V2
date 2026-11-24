package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// package-helper.mjs generates this archive in the build directory.
//
//go:embed lib.zip
var payload []byte

const title = "Giraffe Studio"

var ptr = windows.StringToUTF16Ptr

func message(text string, style uint32) int32 {
	reply, _ := windows.MessageBox(0, ptr(text), ptr(title), style)
	return reply
}
func hidden(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}
func unpack(archive []byte, dir string) error {
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return err
	}
	for _, item := range zr.File {
		name := filepath.FromSlash(strings.TrimSuffix(item.Name, "/"))
		if !filepath.IsLocal(name) {
			return fmt.Errorf("invalid archive path")
		}
		dest := filepath.Join(dir, name)
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(dest, 0700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		in, err := item.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(dest)
		if err != nil {
			in.Close()
			return err
		}
		_, err = io.Copy(out, in)
		in.Close()
		closeErr := out.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}
func download(url, sum, dir string) error {
	client := &http.Client{Timeout: 10 * time.Minute}
	r, err := client.Get(url)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return fmt.Errorf("다운로드 실패 (%d)", r.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 150<<20))
	if err != nil {
		return err
	}
	if fmt.Sprintf("%x", sha256.Sum256(b)) != sum {
		return fmt.Errorf("다운로드한 도구의 체크섬이 다릅니다")
	}
	return unpack(b, dir)
}
func setRegistry(path, name, value string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue(name, value)
}
func dependencies(dir, node string) error {
	// The first launch shows the actual installer's output while downloading Blender.
	windows.NewLazySystemDLL("kernel32.dll").NewProc("AllocConsole").Call()
	console, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	defer console.Close()
	fmt.Fprintln(console, "Giraffe Studio - preparing Blender on this computer...")
	if err := unpack(payload, dir); err != nil {
		return err
	}
	if err := download("https://nodejs.org/dist/v22.17.0/node-v22.17.0-win-x64.zip", "721ab118a3aac8584348b132767eadf51379e0616f0db802cc1e66d7f0d98f85", dir); err != nil {
		return err
	}
	if err := download("https://github.com/astral-sh/uv/releases/download/0.9.5/uv-x86_64-pc-windows-msvc.zip", "515dc53d7553f1357d0abc1f70acd921fbb9e30230b1d9a08737236daa6ee920", dir); err != nil {
		return err
	}
	// uv's managed base interpreter and all wheels live inside this release.
	setEnv := func(k, v string) { os.Setenv(k, v) }
	setEnv("UV_PYTHON_INSTALL_DIR", filepath.Join(dir, "python"))
	setEnv("UV_LINK_MODE", "copy")
	setEnv("PATH", filepath.Dir(node)+";"+os.Getenv("PATH"))
	uv := filepath.Join(dir, "uv.exe")
	run := func(cmd *exec.Cmd) error { cmd.Dir = dir; cmd.Stdout = console; cmd.Stderr = console; return cmd.Run() }
	for _, args := range [][]string{{"python", "install", "3.11.14"}, {"venv", "--managed-python", "--python", "3.11.14", ".venv"}, {"pip", "install", "--python", filepath.Join(dir, ".venv", "Scripts", "python.exe"), "--only-binary=:all:", "-r", "world/requirements.txt"}} {
		if err := run(hidden(uv, args...)); err != nil {
			return err
		}
	}
	npm := filepath.Join(filepath.Dir(node), "node_modules", "npm", "bin", "npm-cli.js")
	if err := run(hidden(node, npm, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund")); err != nil {
		return err
	}
	py := hidden(uv, "python", "find", "--managed-python", "--system", "3.11.14")
	py.Dir = dir
	base, err := py.Output()
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(dir, "python-path"), bytes.TrimSpace(base), 0600); err != nil {
		return err
	}
	if err = prepareSandbox(dir); err != nil {
		return err
	}
	test, err := os.MkdirTemp("", "giraffe-setup-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(test)
	if err = isolated(dir, test, []string{"-c", "import bpy, os; os._exit(0)"}); err != nil {
		return err
	}
	if err = run(hidden(node, "--input-type=module", "-e", "await import('./helper/publish.mjs')")); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "ready"), nil, 0600)
}

func launch() error {
	if len(os.Args) > 1 && os.Args[1] == "--worker" {
		return worker(os.Args[2:])
	}
	background := len(os.Args) > 1 && os.Args[1] == "--login"
	root := filepath.Join(os.Getenv("LOCALAPPDATA"), "Living Like A Giraffe")
	hash := sha256.Sum256(payload)
	dir := filepath.Join(root, fmt.Sprintf("%x", hash[:10]))
	node := filepath.Join(dir, "node-v22.17.0-win-x64", "node.exe")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	lock, err := windows.CreateMutex(nil, false, ptr(`Local\LivingLikeAGiraffeSetup`))
	if err != nil && err != windows.ERROR_ALREADY_EXISTS {
		return err
	}
	defer windows.CloseHandle(lock)
	wait, err := windows.WaitForSingleObject(lock, 20*60*1000)
	if err != nil || (wait != windows.WAIT_OBJECT_0 && wait != windows.WAIT_ABANDONED) {
		return fmt.Errorf("다른 설치가 진행 중입니다")
	}
	defer windows.ReleaseMutex(lock)
	if _, err := os.Stat(filepath.Join(dir, "ready")); os.IsNotExist(err) {
		if err := dependencies(dir, node); err != nil {
			return err
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	installed := filepath.Join(dir, "Giraffe Studio.exe")
	if !strings.EqualFold(exe, installed) {
		data, err := os.ReadFile(exe)
		if err != nil {
			return err
		}
		if _, err = os.Stat(installed); os.IsNotExist(err) {
			if err = os.WriteFile(installed, data, 0700); err != nil {
				return err
			}
		}
	}
	const scheme = `Software\Classes\giraffe-studio`
	if err = setRegistry(scheme, "", "URL:Giraffe Studio"); err != nil {
		return err
	}
	if err = setRegistry(scheme, "URL Protocol", ""); err != nil {
		return err
	}
	// The scheme always opens the same studio. Never pass URI-supplied arguments.
	if err = setRegistry(scheme+`\shell\open\command`, "", windows.ComposeCommandLine([]string{installed})); err != nil {
		return err
	}
	bridge := hidden(node, "helper/bridge.mjs", root)
	bridge.Dir = dir
	if err = bridge.Start(); err != nil {
		return err
	}
	bridge.Process.Release()
	if background {
		return nil
	}
	check := hidden(node, "helper/connect.mjs", root)
	check.Dir = dir
	link, err := check.Output()
	if err != nil {
		return fmt.Errorf("도우미 연결에 실패했습니다. 다시 열어 주세요.")
	}
	const loginKey = `Software\Microsoft\Windows\CurrentVersion\Run`
	choice := filepath.Join(root, "login-choice")
	if _, err = os.Stat(choice); os.IsNotExist(err) {
		if message("Windows에 로그인할 때 도우미를 자동으로 켤까요?", 4) == 6 {
			if err = setRegistry(loginKey, title, windows.ComposeCommandLine([]string{installed, "--login"})); err != nil {
				return err
			}
			if err = os.WriteFile(choice, []byte("on"), 0600); err != nil {
				return err
			}
		} else if err = os.WriteFile(choice, []byte("off"), 0600); err != nil {
			return err
		}
	} else if v, _ := os.ReadFile(choice); string(v) == "on" {
		if err = setRegistry(loginKey, title, windows.ComposeCommandLine([]string{installed, "--login"})); err != nil {
			return err
		}
	}
	message("준비됐어요. 확인을 누르면 스튜디오가 열립니다.", 0)
	return windows.ShellExecute(0, ptr("open"), ptr(string(link)), nil, nil, 1)
}
func main() {
	if err := launch(); err != nil {
		if len(os.Args) > 1 && os.Args[1] == "--worker" {
			fmt.Fprintln(os.Stderr, "Error:", err)
		} else {
			message(err.Error(), 16)
		}
		os.Exit(1)
	}
}
