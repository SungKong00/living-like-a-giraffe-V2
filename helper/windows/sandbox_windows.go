package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var userenv = windows.NewLazySystemDLL("userenv.dll")

func containerSID() (*windows.SID, error) {
	name := ptr("LivingLikeAGiraffe.Blender")
	arg := uintptr(unsafe.Pointer(name))
	var sid *windows.SID
	result, _, _ := userenv.NewProc("CreateAppContainerProfile").Call(arg, arg, arg, 0, 0, uintptr(unsafe.Pointer(&sid)))
	if uint32(result) == 0x800700b7 { // HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)
		result, _, _ = userenv.NewProc("DeriveAppContainerSidFromAppContainerName").Call(arg, uintptr(unsafe.Pointer(&sid)))
	}
	runtime.KeepAlive(name)
	if result != 0 {
		return nil, fmt.Errorf("AppContainer 준비 실패 (%x)", result)
	}
	return sid, nil
}
func acl(args ...string) error {
	// Resolve the OS utility independently of the current working directory.
	system, err := windows.GetSystemDirectory()
	if err != nil {
		return err
	}
	output, err := hidden(filepath.Join(system, "icacls.exe"), args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("작업 폴더 권한 설정 실패: %v %s", err, output)
	}
	return nil
}
func prepareSandbox(dir string) error {
	sid, err := containerSID()
	if err != nil {
		return err
	}
	defer windows.FreeSid(sid)
	grant := "*" + sid.String() + ":(OI)(CI)RX"
	for _, name := range []string{"python", ".venv", "world"} {
		if err := acl(filepath.Join(dir, name), "/grant", grant, "/T", "/Q"); err != nil {
			return err
		}
	}
	return nil
}

type securityCapabilities struct {
	sid             *windows.SID
	capabilities    uintptr
	count, reserved uint32
}

func worker(args []string) error {
	if len(args) < 4 || len(args) > 6 {
		return fmt.Errorf("잘못된 Blender 작업입니다")
	}
	root, err := os.Getwd()
	if err != nil {
		return err
	}
	return isolated(root, args[0], args[1:])
}
func isolated(root, work string, scriptArgs []string) error {
	sid, err := containerSID()
	if err != nil {
		return err
	}
	defer windows.FreeSid(sid)
	if err = acl(work, "/grant", "*"+sid.String()+":(OI)(CI)M", "/T", "/Q"); err != nil {
		return err
	}
	if err = acl(work, "/setintegritylevel", "(OI)(CI)L", "/T", "/Q"); err != nil {
		return err
	}
	base, err := os.ReadFile(filepath.Join(root, "python-path"))
	if err != nil {
		return err
	}
	python := string(base)
	args := append([]string{python}, scriptArgs...)
	attrs, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return err
	}
	defer attrs.Delete()
	caps := securityCapabilities{sid: sid}
	const procThreadAttributeSecurityCapabilities = 0x00020009
	if err = attrs.Update(procThreadAttributeSecurityCapabilities, unsafe.Pointer(&caps), unsafe.Sizeof(caps)); err != nil {
		return err
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(job)
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{JobMemoryLimit: 6 << 30}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_JOB_MEMORY | windows.JOB_OBJECT_LIMIT_JOB_TIME | windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	limits.BasicLimitInformation.PerJobUserTimeLimit = 900 * 10000000
	_, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits)))
	if err != nil {
		return err
	}
	sysroot := os.Getenv("SystemRoot")
	env := []string{"PATH=" + filepath.Dir(python) + ";" + filepath.Join(sysroot, "System32"), "PYTHONDONTWRITEBYTECODE=1", "PYTHONNOUSERSITE=1", "PYTHONPATH=" + filepath.Join(root, ".venv", "Lib", "site-packages"), "PYTHONUTF8=1", "SystemRoot=" + sysroot, "TEMP=" + work, "TMP=" + work, "USERPROFILE=" + work}
	block := utf16.Encode([]rune(strings.Join(env, "\x00") + "\x00\x00"))
	info := windows.StartupInfoEx{ProcThreadAttributeList: attrs.List()}
	info.Cb = uint32(unsafe.Sizeof(info))
	var pi windows.ProcessInformation
	flags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_UNICODE_ENVIRONMENT | windows.CREATE_NO_WINDOW | windows.CREATE_SUSPENDED)
	err = windows.CreateProcess(ptr(python), ptr(windows.ComposeCommandLine(args)), nil, nil, false, flags, &block[0], ptr(work), &info.StartupInfo, &pi)
	runtime.KeepAlive(caps)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(pi.Process)
	defer windows.CloseHandle(pi.Thread)
	if err = windows.AssignProcessToJobObject(job, pi.Process); err != nil {
		windows.TerminateProcess(pi.Process, 1)
		return err
	}
	if _, err = windows.ResumeThread(pi.Thread); err != nil {
		return err
	}
	result, err := windows.WaitForSingleObject(pi.Process, 900000)
	if err != nil {
		return err
	}
	if result != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("Blender 처리 시간이 초과되었습니다")
	}
	var code uint32
	if err = windows.GetExitCodeProcess(pi.Process, &code); err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("Blender 종료 코드 %x", code)
	}
	return nil
}
