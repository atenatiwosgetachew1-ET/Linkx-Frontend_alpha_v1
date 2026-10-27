#!/usr/bin/env python3
"""
containment_fs.py - Descriptor-Relative Path Containment Engine for Linkx Releases
=================================================================================
Implements strictly isolated filesystem operations anchored to directory file
descriptors using Linux openat2(RESOLVE_BENEATH) and POSIX descriptor syscalls.

Safety Invariants:
1. No mutation or lookup may escape the root directory descriptor.
2. Traversal patterns ('..') and absolute paths are rejected with exit code 99.
3. Every file write is flushed via fsync() on both the file and containing directory.
4. If openat2(RESOLVE_BENEATH) is unavailable or fails, execution halts closed (exit 99).
5. Storage hardware failures (EIO, ENOSPC, EROFS) immediately halt execution (exit 2).
"""

import ctypes
import os
import sys
import argparse
import stat
import errno

# Linux x86_64 Syscall Numbers
SYS_openat2 = 437
SYS_renameat2 = 316
SYS_symlinkat = 266
SYS_mkdirat = 258
SYS_unlinkat = 263
SYS_fchmodat = 268

# Linux openat2 RESOLVE_* Flags
RESOLVE_NO_XDEV = 0x01
RESOLVE_NO_MAGICLINKS = 0x02
RESOLVE_NO_SYMLINKS = 0x04
RESOLVE_BENEATH = 0x08
RESOLVE_IN_ROOT = 0x10

# POSIX / Linux Flags
AT_SYMLINK_NOFOLLOW = 0x100
AT_REMOVEDIR = 0x200

# Exit Codes
EXIT_SUCCESS = 0
EXIT_ERROR = 1
EXIT_STORAGE_FAULT = 2
EXIT_AMBIGUOUS_STATE = 98
EXIT_CONTAINMENT_PROBE_FAILED = 99


class OpenHow(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_uint64),
        ("mode", ctypes.c_uint64),
        ("resolve", ctypes.c_uint64),
    ]


# Bind libc syscall
_libc = ctypes.CDLL(None, use_errno=True)
_syscall = _libc.syscall


def _check_leaf_name(name: str) -> None:
    """Ensures a filename/entry name is a pure leaf component."""
    if not name or "/" in name or name in (".", ".."):
        sys.stderr.write(f"[CONTAINMENT_ERROR] Invalid leaf name '{name}': path separators or traversal prohibited.\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)


def _check_relative_target(target: str) -> None:
    """Ensures a symlink target string is purely relative and does not escape."""
    if not target or target.startswith("/"):
        sys.stderr.write(f"[CONTAINMENT_ERROR] Invalid target '{target}': absolute target prohibited.\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
    parts = target.split("/")
    depth = 0
    for part in parts:
        if part == "..":
            depth -= 1
        elif part and part != ".":
            depth += 1
        if depth < 0:
            sys.stderr.write(f"[CONTAINMENT_ERROR] Target '{target}' escapes parent hierarchy via '..'.\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)


def cfs_probe_containment(fixture_path: str) -> bool:
    """
    Non-mutating self-test probe verifying that openat2 with RESOLVE_BENEATH
    operates on the given directory. Fails closed with exit 99 if unsupported.
    """
    if not os.path.isdir(fixture_path):
        sys.stderr.write(f"[FATAL] Probe target is not a directory: {fixture_path}\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

    try:
        dfd = os.open(fixture_path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    except OSError as e:
        sys.stderr.write(f"[FATAL] Cannot open directory descriptor for {fixture_path}: {e}\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

    try:
        how = OpenHow(flags=os.O_RDONLY | os.O_DIRECTORY, mode=0, resolve=RESOLVE_BENEATH)
        res = _syscall(SYS_openat2, dfd, b".", ctypes.byref(how), ctypes.sizeof(how))
        if res < 0:
            err = ctypes.get_errno()
            sys.stderr.write(f"[FATAL] Kernel openat2(RESOLVE_BENEATH) probe failed (errno {err}).\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        os.close(res)
        return True
    finally:
        os.close(dfd)


def cfs_device_check(path1: str, path2: str) -> bool:
    """Verifies both paths reside on the exact same underlying filesystem device."""
    try:
        st1 = os.stat(path1)
        st2 = os.stat(path2)
        if st1.st_dev != st2.st_dev:
            sys.stderr.write(
                f"[FATAL] Device mismatch: '{path1}' (dev {st1.st_dev}) and '{path2}' (dev {st2.st_dev}) reside on different devices.\n"
            )
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        return True
    except OSError as e:
        sys.stderr.write(f"[FATAL] Device check stat failed: {e}\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)


def cfs_openat(parent_dfd: int, rel_path: str, flags: int, mode: int = 0, resolve_flags: int = RESOLVE_BENEATH) -> int:
    """Opens a file or directory relative to parent_dfd with kernel resolution constraints."""
    if rel_path.startswith("/") or ".." in rel_path.split("/"):
        sys.stderr.write(f"[CONTAINMENT_ERROR] Path '{rel_path}' violates relative containment.\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

    # In Linux openat2(2), how.mode must be 0 unless O_CREAT or O_TMPFILE is specified in flags
    o_tmpfile = getattr(os, "O_TMPFILE", 0o20200000)
    effective_mode = mode if (flags & (os.O_CREAT | o_tmpfile)) else 0

    how = OpenHow(flags=flags, mode=effective_mode, resolve=resolve_flags)
    fd = _syscall(SYS_openat2, parent_dfd, rel_path.encode("utf-8"), ctypes.byref(how), ctypes.sizeof(how))
    if fd < 0:
        err = ctypes.get_errno()
        if err in (errno.ENOSPC, errno.EROFS, errno.EIO, getattr(errno, "EDQUOT", 122)):
            sys.stderr.write(f"[STORAGE_FAULT] openat2 storage fault on '{rel_path}' (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_STORAGE_FAULT)
        if err == errno.ESTALE:
            sys.stderr.write(f"[AMBIGUOUS_STATE] openat2 stale file handle on '{rel_path}' (errno {err})\n")
            sys.exit(EXIT_AMBIGUOUS_STATE)
        if err == errno.EXDEV:
            sys.stderr.write(f"[CONTAINMENT_ERROR] openat2 crossed boundary / escaped root on '{rel_path}' (errno {err}: EXDEV)\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        if err == errno.ELOOP:
            sys.stderr.write(f"[CONTAINMENT_ERROR] openat2 symlink resolution prohibited on '{rel_path}' (errno {err}: ELOOP)\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        sys.stderr.write(f"[CONTAINMENT_ERROR] openat2 failed on '{rel_path}' with errno {err} ({os.strerror(err)})\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
    return fd


def cfs_mkdir(parent_path: str, leaf_dirname: str, mode: int = 0o755) -> None:
    """Creates a directory strictly beneath parent_path and commits parent directory entry."""
    _check_leaf_name(leaf_dirname)
    dfd = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        res = _syscall(SYS_mkdirat, dfd, leaf_dirname.encode("utf-8"), mode)
        if res < 0:
            err = ctypes.get_errno()
            if err == errno.EEXIST:
                return
            if err in (errno.ENOSPC, errno.EROFS, errno.EIO, getattr(errno, "EDQUOT", 122)):
                sys.stderr.write(f"[STORAGE_FAULT] mkdirat storage fault on '{leaf_dirname}' (errno {err}: {os.strerror(err)})\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if err == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] mkdirat stale handle on '{leaf_dirname}' (errno {err})\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            sys.stderr.write(f"[CONTAINMENT_ERROR] mkdirat failed on '{leaf_dirname}' (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        os.fsync(dfd)
    finally:
        os.close(dfd)


def cfs_write_atomic(target_dir: str, tmp_dir: str, leaf_filename: str, payload_bytes: bytes, mode: int = 0o644) -> None:
    """
    Atomically writes payload to tmp_dir, flushes via fsync, renames over
    target_dir/leaf_filename, and fsyncs target directory descriptor.
    """
    _check_leaf_name(leaf_filename)
    cfs_device_check(target_dir, tmp_dir)

    tmp_dfd = os.open(tmp_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    target_dfd = os.open(target_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)

    tmp_name = f"{leaf_filename}.tmp.{os.getpid()}_{os.urandom(4).hex()}"
    try:
        # Open staged file in tmp_dir with RESOLVE_BENEATH
        how = OpenHow(
            flags=os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
            mode=mode,
            resolve=RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS,
        )
        fd = _syscall(SYS_openat2, tmp_dfd, tmp_name.encode("utf-8"), ctypes.byref(how), ctypes.sizeof(how))
        if fd < 0:
            err = ctypes.get_errno()
            if err in (errno.ENOSPC, errno.EROFS, errno.EIO, getattr(errno, "EDQUOT", 122)):
                sys.stderr.write(f"[STORAGE_FAULT] openat2 create failed on tmp file '{tmp_name}' (errno {err}: {os.strerror(err)})\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if err == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] openat2 create stale handle on tmp file '{tmp_name}' (errno {err})\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            if err == errno.EXDEV:
                sys.stderr.write(f"[CONTAINMENT_ERROR] openat2 create crossed boundary on tmp file '{tmp_name}' (errno {err}: EXDEV)\n")
                sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
            sys.stderr.write(f"[CONTAINMENT_ERROR] openat2 create failed on tmp file '{tmp_name}' (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

        try:
            total = 0
            while total < len(payload_bytes):
                written = os.write(fd, payload_bytes[total:])
                if written <= 0:
                    break
                total += written
            os.fsync(fd)
        finally:
            os.close(fd)

        # Commit via atomic renameat2 across descriptors
        res = _syscall(
            SYS_renameat2,
            tmp_dfd,
            tmp_name.encode("utf-8"),
            target_dfd,
            leaf_filename.encode("utf-8"),
            0,
        )
        if res < 0:
            err = ctypes.get_errno()
            if err in (errno.ENOSPC, errno.EROFS, errno.EIO, getattr(errno, "EDQUOT", 122)):
                sys.stderr.write(f"[STORAGE_FAULT] renameat2 atomic commit storage fault (errno {err}: {os.strerror(err)})\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if err == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] renameat2 atomic commit stale handle (errno {err})\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            if err == errno.EXDEV:
                sys.stderr.write(f"[CONTAINMENT_ERROR] renameat2 atomic commit cross-device error (errno {err}: EXDEV)\n")
                sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
            sys.stderr.write(f"[CONTAINMENT_ERROR] renameat2 atomic commit failed (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

        os.fsync(target_dfd)
    finally:
        os.close(tmp_dfd)
        os.close(target_dfd)


def cfs_symlink_atomic(parent_dir: str, target_rel_path: str, final_link_name: str, staged_tmp_name: str) -> None:
    """
    Creates a temporary symlink beneath parent_dir targeting target_rel_path,
    then atomically swaps it over final_link_name and fsyncs parent_dir.
    """
    _check_relative_target(target_rel_path)
    _check_leaf_name(final_link_name)
    _check_leaf_name(staged_tmp_name)

    dfd = os.open(parent_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        # Create temporary link
        res = _syscall(SYS_symlinkat, target_rel_path.encode("utf-8"), dfd, staged_tmp_name.encode("utf-8"))
        if res < 0:
            err = ctypes.get_errno()
            if err in (errno.ENOSPC, errno.EROFS, errno.EIO, getattr(errno, "EDQUOT", 122)):
                sys.stderr.write(f"[STORAGE_FAULT] symlinkat storage fault on '{staged_tmp_name}' (errno {err}: {os.strerror(err)})\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if err == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] symlinkat stale handle on '{staged_tmp_name}' (errno {err})\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            sys.stderr.write(f"[CONTAINMENT_ERROR] symlinkat failed on '{staged_tmp_name}' (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

        os.fsync(dfd)

        # Atomic swap over final link name
        res = _syscall(
            SYS_renameat2,
            dfd,
            staged_tmp_name.encode("utf-8"),
            dfd,
            final_link_name.encode("utf-8"),
            0,
        )
        if res < 0:
            err = ctypes.get_errno()
            if err in (errno.ENOSPC, errno.EROFS, errno.EIO, getattr(errno, "EDQUOT", 122)):
                sys.stderr.write(f"[STORAGE_FAULT] renameat2 symlink swap storage fault (errno {err}: {os.strerror(err)})\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if err == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] renameat2 symlink swap stale handle (errno {err})\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            if err == errno.EXDEV:
                sys.stderr.write(f"[CONTAINMENT_ERROR] renameat2 symlink swap cross-device link error (errno {err}: EXDEV)\n")
                sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
            sys.stderr.write(f"[CONTAINMENT_ERROR] renameat2 symlink swap failed (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

        os.fsync(dfd)
    finally:
        os.close(dfd)


def cfs_rename(src_dir: str, src_name: str, dst_dir: str, dst_name: str, flags: int = 0) -> None:
    """Executes atomic renameat2 between directory descriptors and fsyncs destination."""
    _check_leaf_name(src_name)
    _check_leaf_name(dst_name)
    cfs_device_check(src_dir, dst_dir)

    src_dfd = os.open(src_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    dst_dfd = os.open(dst_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        res = _syscall(
            SYS_renameat2,
            src_dfd,
            src_name.encode("utf-8"),
            dst_dfd,
            dst_name.encode("utf-8"),
            flags,
        )
        if res < 0:
            err = ctypes.get_errno()
            if err in (errno.ENOSPC, errno.EROFS, errno.EIO, getattr(errno, "EDQUOT", 122)):
                sys.stderr.write(f"[STORAGE_FAULT] renameat2 failed '{src_name}' -> '{dst_name}': {os.strerror(err)} (errno {err})\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if err == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] renameat2 failed '{src_name}' -> '{dst_name}' with stale handle (errno {err})\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            if err == errno.EXDEV:
                sys.stderr.write(f"[CONTAINMENT_ERROR] renameat2 cross-device error '{src_name}' -> '{dst_name}' (errno {err}: EXDEV)\n")
                sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
            sys.stderr.write(f"[CONTAINMENT_ERROR] renameat2 failed '{src_name}' -> '{dst_name}' (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        os.fsync(dst_dfd)
    finally:
        os.close(src_dfd)
        os.close(dst_dfd)


def cfs_fchmod(parent_dir: str, leaf_name: str, mode: int) -> None:
    """Enforces mode without following symlinks via fchmodat(AT_SYMLINK_NOFOLLOW)."""
    _check_leaf_name(leaf_name)
    dfd = os.open(parent_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        res = _syscall(SYS_fchmodat, dfd, leaf_name.encode("utf-8"), mode, AT_SYMLINK_NOFOLLOW)
        if res < 0:
            err = ctypes.get_errno()
            if err in (errno.EROFS, errno.EIO):
                sys.stderr.write(f"[STORAGE_FAULT] fchmodat storage fault on '{leaf_name}' (errno {err}: {os.strerror(err)})\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if err == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] fchmodat stale handle on '{leaf_name}' (errno {err})\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            sys.stderr.write(f"[CONTAINMENT_ERROR] fchmodat failed on '{leaf_name}' (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        os.fsync(dfd)
    finally:
        os.close(dfd)


def cfs_unlink(parent_dir: str, leaf_name: str, is_dir: bool = False) -> None:
    """Unlinks a directory entry directly beneath parent_dir and fsyncs parent."""
    _check_leaf_name(leaf_name)
    dfd = os.open(parent_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        flags = AT_REMOVEDIR if is_dir else 0
        res = _syscall(SYS_unlinkat, dfd, leaf_name.encode("utf-8"), flags)
        if res < 0:
            err = ctypes.get_errno()
            if err == errno.ENOENT:
                return
            if err in (errno.EROFS, errno.EIO):
                sys.stderr.write(f"[STORAGE_FAULT] unlinkat storage fault on '{leaf_name}' (errno {err}: {os.strerror(err)})\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if err == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] unlinkat stale handle on '{leaf_name}' (errno {err})\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            sys.stderr.write(f"[CONTAINMENT_ERROR] unlinkat failed on '{leaf_name}' (errno {err}: {os.strerror(err)})\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        os.fsync(dfd)
    finally:
        os.close(dfd)


def cfs_readlink(parent_dir: str, link_name: str) -> str:
    """Reads symlink target directly beneath parent_dir without traversing through it."""
    _check_leaf_name(link_name)
    full_path = os.path.join(parent_dir, link_name)
    try:
        return os.readlink(full_path)
    except OSError as e:
        if e.errno == errno.ESTALE:
            sys.stderr.write(f"[AMBIGUOUS_STATE] readlink failed on '{link_name}' with stale handle\n")
            sys.exit(EXIT_AMBIGUOUS_STATE)
        if e.errno in (errno.EIO,):
            sys.stderr.write(f"[STORAGE_FAULT] readlink failed on '{link_name}': {e}\n")
            sys.exit(EXIT_STORAGE_FAULT)
        sys.stderr.write(f"[CONTAINMENT_ERROR] readlink failed on '{link_name}': {e}\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)


def _rmtree_descriptor(dfd: int) -> None:
    """
    Recursively deletes all entries within directory file descriptor dfd.
    Does not follow symlinks; unlinks symlinks directly.
    Only traverses real directory entries.
    """
    try:
        entries = os.listdir(dfd)
    except OSError as e:
        if e.errno in (errno.EROFS, errno.EIO):
            sys.stderr.write(f"[STORAGE_FAULT] listdir failed on descriptor {dfd}: {e}\n")
            sys.exit(EXIT_STORAGE_FAULT)
        if e.errno == errno.ESTALE:
            sys.stderr.write(f"[AMBIGUOUS_STATE] listdir failed on descriptor {dfd} with stale handle\n")
            sys.exit(EXIT_AMBIGUOUS_STATE)
        sys.stderr.write(f"[CONTAINMENT_ERROR] listdir failed on descriptor {dfd}: {e}\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

    for entry in entries:
        if entry in (".", ".."):
            continue
        _check_leaf_name(entry)

        try:
            st = os.stat(entry, dir_fd=dfd, follow_symlinks=False)
        except OSError as e:
            if e.errno == errno.ENOENT:
                continue
            if e.errno in (errno.EROFS, errno.EIO):
                sys.stderr.write(f"[STORAGE_FAULT] fstatat failed on '{entry}': {e}\n")
                sys.exit(EXIT_STORAGE_FAULT)
            if e.errno == errno.ESTALE:
                sys.stderr.write(f"[AMBIGUOUS_STATE] fstatat failed on '{entry}' with stale handle\n")
                sys.exit(EXIT_AMBIGUOUS_STATE)
            sys.stderr.write(f"[CONTAINMENT_ERROR] fstatat failed on '{entry}': {e}\n")
            sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

        if stat.S_ISDIR(st.st_mode):
            sub_dfd = cfs_openat(
                dfd,
                entry,
                os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC,
                mode=0,
                resolve_flags=RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS,
            )
            try:
                _rmtree_descriptor(sub_dfd)
            finally:
                os.close(sub_dfd)

            res = _syscall(SYS_unlinkat, dfd, entry.encode("utf-8"), AT_REMOVEDIR)
            if res < 0:
                err = ctypes.get_errno()
                if err != errno.ENOENT:
                    if err in (errno.EROFS, errno.EIO):
                        sys.stderr.write(f"[STORAGE_FAULT] unlinkat (rmdir) failed on '{entry}' (errno {err})\n")
                        sys.exit(EXIT_STORAGE_FAULT)
                    if err == errno.ESTALE:
                        sys.stderr.write(f"[AMBIGUOUS_STATE] unlinkat (rmdir) failed on '{entry}' with stale handle\n")
                        sys.exit(EXIT_AMBIGUOUS_STATE)
                    sys.stderr.write(f"[CONTAINMENT_ERROR] unlinkat (rmdir) failed on '{entry}' (errno {err})\n")
                    sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)
        else:
            res = _syscall(SYS_unlinkat, dfd, entry.encode("utf-8"), 0)
            if res < 0:
                err = ctypes.get_errno()
                if err != errno.ENOENT:
                    if err in (errno.EROFS, errno.EIO):
                        sys.stderr.write(f"[STORAGE_FAULT] unlinkat failed on '{entry}' (errno {err})\n")
                        sys.exit(EXIT_STORAGE_FAULT)
                    if err == errno.ESTALE:
                        sys.stderr.write(f"[AMBIGUOUS_STATE] unlinkat failed on '{entry}' with stale handle\n")
                        sys.exit(EXIT_AMBIGUOUS_STATE)
                    sys.stderr.write(f"[CONTAINMENT_ERROR] unlinkat failed on '{entry}' (errno {err})\n")
                    sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

    try:
        os.fsync(dfd)
    except OSError as e:
        if e.errno in (errno.EROFS, errno.EIO):
            sys.stderr.write(f"[STORAGE_FAULT] fsync failed on directory descriptor {dfd}: {e}\n")
            sys.exit(EXIT_STORAGE_FAULT)


def cfs_rmtree(parent_dir: str, leaf_dirname: str) -> None:
    """
    Recursively removes a directory strictly confined beneath parent_dir.
    Guarantees no symlink traversal and descriptor confinement at every level.
    """
    _check_leaf_name(leaf_dirname)
    if leaf_dirname in ("current", "previous"):
        sys.stderr.write(f"[CONTAINMENT_ERROR] Protected pointer name '{leaf_dirname}' cannot be rmtree'd.\n")
        sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

    parent_dfd = os.open(parent_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        target_dfd = cfs_openat(
            parent_dfd,
            leaf_dirname,
            os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC,
            mode=0,
            resolve_flags=RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS,
        )
        try:
            _rmtree_descriptor(target_dfd)
        finally:
            os.close(target_dfd)

        res = _syscall(SYS_unlinkat, parent_dfd, leaf_dirname.encode("utf-8"), AT_REMOVEDIR)
        if res < 0:
            err = ctypes.get_errno()
            if err != errno.ENOENT:
                if err in (errno.EROFS, errno.EIO):
                    sys.stderr.write(f"[STORAGE_FAULT] unlinkat candidate dir failed on '{leaf_dirname}' (errno {err})\n")
                    sys.exit(EXIT_STORAGE_FAULT)
                if err == errno.ESTALE:
                    sys.stderr.write(f"[AMBIGUOUS_STATE] unlinkat candidate dir failed on '{leaf_dirname}' with stale handle\n")
                    sys.exit(EXIT_AMBIGUOUS_STATE)
                sys.stderr.write(f"[CONTAINMENT_ERROR] unlinkat candidate dir failed on '{leaf_dirname}' (errno {err})\n")
                sys.exit(EXIT_CONTAINMENT_PROBE_FAILED)

        os.fsync(parent_dfd)
    finally:
        os.close(parent_dfd)


def main() -> None:
    parser = argparse.ArgumentParser(description="ContainmentFS Command-Line Syscall Helper")
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    # probe
    p_probe = subparsers.add_parser("probe")
    p_probe.add_argument("fixture_path")

    # device-check
    p_dev = subparsers.add_parser("device-check")
    p_dev.add_argument("path1")
    p_dev.add_argument("path2")

    # mkdir
    p_mkdir = subparsers.add_parser("mkdir")
    p_mkdir.add_argument("parent_dir")
    p_mkdir.add_argument("leaf_dirname")
    p_mkdir.add_argument("--mode", type=lambda x: int(x, 8), default=0o755)

    # write-atomic
    p_write = subparsers.add_parser("write-atomic")
    p_write.add_argument("target_dir")
    p_write.add_argument("tmp_dir")
    p_write.add_argument("leaf_filename")
    p_write.add_argument("--data-file", default=None, help="File to read payload from; reads stdin if omitted")
    p_write.add_argument("--mode", type=lambda x: int(x, 8), default=0o644)

    # symlink-atomic
    p_symlink = subparsers.add_parser("symlink-atomic")
    p_symlink.add_argument("parent_dir")
    p_symlink.add_argument("target_rel_path")
    p_symlink.add_argument("final_link_name")
    p_symlink.add_argument("staged_tmp_name")

    # rename
    p_rename = subparsers.add_parser("rename")
    p_rename.add_argument("src_dir")
    p_rename.add_argument("src_name")
    p_rename.add_argument("dst_dir")
    p_rename.add_argument("dst_name")
    p_rename.add_argument("--flags", type=int, default=0)

    # fchmod
    p_chmod = subparsers.add_parser("fchmod")
    p_chmod.add_argument("parent_dir")
    p_chmod.add_argument("leaf_name")
    p_chmod.add_argument("mode", type=lambda x: int(x, 8))

    # unlink
    p_unlink = subparsers.add_parser("unlink")
    p_unlink.add_argument("parent_dir")
    p_unlink.add_argument("leaf_name")
    p_unlink.add_argument("--dir", action="store_true")

    # readlink
    p_readlink = subparsers.add_parser("readlink")
    p_readlink.add_argument("parent_dir")
    p_readlink.add_argument("link_name")

    # rmtree
    p_rmtree = subparsers.add_parser("rmtree")
    p_rmtree.add_argument("parent_dir")
    p_rmtree.add_argument("leaf_dirname")

    args = parser.parse_args()

    if args.cmd == "probe":
        cfs_probe_containment(args.fixture_path)
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "device-check":
        cfs_device_check(args.path1, args.path2)
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "mkdir":
        cfs_mkdir(args.parent_dir, args.leaf_dirname, args.mode)
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "write-atomic":
        if args.data_file:
            with open(args.data_file, "rb") as f:
                payload = f.read()
        else:
            payload = sys.stdin.buffer.read()
        cfs_write_atomic(args.target_dir, args.tmp_dir, args.leaf_filename, payload, args.mode)
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "symlink-atomic":
        cfs_symlink_atomic(args.parent_dir, args.target_rel_path, args.final_link_name, args.staged_tmp_name)
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "rename":
        cfs_rename(args.src_dir, args.src_name, args.dst_dir, args.dst_name, args.flags)
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "fchmod":
        cfs_fchmod(args.parent_dir, args.leaf_name, args.mode)
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "unlink":
        cfs_unlink(args.parent_dir, args.leaf_name, is_dir=args.dir)
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "readlink":
        target = cfs_readlink(args.parent_dir, args.link_name)
        sys.stdout.write(f"{target}\n")
        sys.exit(EXIT_SUCCESS)
    elif args.cmd == "rmtree":
        cfs_rmtree(args.parent_dir, args.leaf_dirname)
        sys.exit(EXIT_SUCCESS)


if __name__ == "__main__":
    main()
