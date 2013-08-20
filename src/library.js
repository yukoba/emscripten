//"use strict";

// An implementation of a libc for the web. Basically, implementations of
// the various standard C libraries, that can be called from compiled code,
// and work using the actual JavaScript environment.
//
// We search the Library object when there is an external function. If the
// entry in the Library is a function, we insert it. If it is a string, we
// do another lookup in the library (a simple way to write a function once,
// if it can be called by different names). We also allow dependencies,
// using __deps. Initialization code to be run after allocating all
// global constants can be defined by __postset.
//
// Note that the full function name will be '_' + the name in the Library
// object. For convenience, the short name appears here. Note that if you add a
// new function with an '_', it will not be found.

// Memory allocated during startup, in postsets, should only be ALLOC_STATIC

LibraryManager.library = {
  // keep this low in memory, because we flatten arrays with them in them
  _impure_ptr: 'allocate(1, "i32*", ALLOC_STATIC)',

  // ==========================================================================
  // dirent.h
  // ==========================================================================

  __linux_dirent_struct_layout: Runtime.generateStructInfo([
    ['i32', 'd_ino'],
    ['i32', 'd_off'],
    ['i16', 'd_reclen'],
    ['b1024', 'd_name'],
    ['i8', 'd_type']]),
  __sys_getdents__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__linux_dirent_struct_layout'],
  __sys_getdents: function(fd, dirp, count) { // TODO Not implemented yet
    // int getdents(unsigned int fd, struct linux_dirent *dirp, unsigned int count);
    // http://man7.org/linux/man-pages/man2/getdents.2.html
    var stream = FS.getStream(fd);
    if (!stream) {
      return ___setErrNo(ERRNO_CODES.EBADF);
    }
    var entries;
    try {
      entries = FS.readdir(stream.path);
    } catch (e) {
      return FS.handleFSError(e);
    }
    for (var i = 0; i < Math.min(count, entries.length); i++) {
      var id;
      var type;
      var name = entries[i];
      var offset = stream.position + 1;
      if (!name.indexOf('.')) {
        id = 1;
        type = 4;
      } else {
        var child = FS.lookupNode(stream.node, name);
        id = child.id;
        type = FS.isChrdev(child.mode) ? 2 :  // DT_CHR, character device.
               FS.isDir(child.mode) ? 4 :     // DT_DIR, directory.
               FS.isLink(child.mode) ? 10 :   // DT_LNK, symbolic link.
               8;                             // DT_REG, regular file.
      }
      {{{ makeSetValue('entry', '___linux_dirent_struct_layout.d_ino', 'id', 'i32') }}}
      {{{ makeSetValue('entry', '___linux_dirent_struct_layout.d_off', 'offset', 'i32') }}}
      // TODO: Only US-ASCII is supported. Support UTF-8.
      {{{ makeSetValue('entry', '___linux_dirent_struct_layout.d_reclen', 'name.length + 12', 'i32') }}}
      for (var i = 0; i < name.length; i++) {
        {{{ makeSetValue('entry + ___linux_dirent_struct_layout.d_name', 'i', 'name.charCodeAt(i) & 0xFF', 'i8') }}}
      }
      {{{ makeSetValue('entry + ___linux_dirent_struct_layout.d_name', 'i', '0', 'i8') }}}
      {{{ makeSetValue('entry', '___linux_dirent_struct_layout.d_type', 'type', 'i8') }}}
    }
    return 0;
  },

  // ==========================================================================
  // utime.h
  // ==========================================================================

  __sys_utime__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_utimes: function(path, times) {
    // int utimes(const char *filename, const struct timeval times[2]);
    // http://man7.org/linux/man-pages/man2/utimes.2.html
    var time;
    if (times) {
      // NOTE: We don't keep track of access timestamps.
      var sec = {{{ makeGetValue('times', '8', 'i32') }}};
      var usec = {{{ makeGetValue('times', '12', 'i32') }}};
      time = sec * 1000 + usec / 1000;
    } else {
      time = Date.now();
    }
    path = Pointer_stringify(path);
    try {
      FS.utime(path, time, time);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },

  // ==========================================================================
  // sys/stat.h
  // ==========================================================================

  __stat_struct_layout: Runtime.generateStructInfo([
    ['i32', 'st_dev'],
    ['i32', 'st_ino'],
    ['i32', 'st_mode'],
    ['i32', 'st_nlink'],
    ['i32', 'st_uid'],
    ['i32', 'st_gid'],
    ['i32', 'st_rdev'],
    ['i32', 'st_size'],
    ['i32', 'st_atime'],
    ['i32', 'st_spare1'],
    ['i32', 'st_mtime'],
    ['i32', 'st_spare2'],
    ['i32', 'st_ctime'],
    ['i32', 'st_spare3'],
    ['i32', 'st_blksize'],
    ['i32', 'st_blocks'],
    ['i32', 'st_spare4']]),
  __sys_stat__deps: ['$FS', '__stat_struct_layout'],
  __sys_stat: function(path, buf, dontResolveLastLink) {
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/stat.html
    // int stat(const char *path, struct stat *buf);
    // NOTE: dontResolveLastLink is a shortcut for lstat(). It should never be
    //       used in client code.
    path = typeof path !== 'string' ? Pointer_stringify(path) : path;
    try {
      var stat = dontResolveLastLink ? FS.lstat(path) : FS.stat(path);
      {{{ makeSetValue('buf', '___stat_struct_layout.st_dev', 'stat.dev', 'i32') }}};
      {{{ makeSetValue('buf', '___stat_struct_layout.st_ino', 'stat.ino', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_mode', 'stat.mode', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_nlink', 'stat.nlink', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_uid', 'stat.uid', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_gid', 'stat.gid', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_rdev', 'stat.rdev', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_size', 'stat.size', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_atime', 'Math.floor(stat.atime.getTime() / 1000)', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_mtime', 'Math.floor(stat.mtime.getTime() / 1000)', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_ctime', 'Math.floor(stat.ctime.getTime() / 1000)', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_blksize', '4096', 'i32') }}}
      {{{ makeSetValue('buf', '___stat_struct_layout.st_blocks', 'stat.blocks', 'i32') }}}
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_lstat__deps: ['stat'],
  __sys_lstat: function(path, buf) {
    // int lstat(const char *path, struct stat *buf);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/lstat.html
    return _stat(path, buf, true);
  },
  __sys_fstat__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'stat'],
  __sys_fstat: function(fildes, buf) {
    // int fstat(int fildes, struct stat *buf);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/fstat.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    return _stat(stream.path, buf);
  },
  __sys_mknod__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_mknod: function(path, mode, dev) {
    // int mknod(const char *path, mode_t mode, dev_t dev);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/mknod.html
    path = Pointer_stringify(path);
    // we don't want this in the JS API as the JS API
    // uses mknod to create all nodes.
    var err = FS.mayMknod(mode);
    if (err) {
      ___setErrNo(err);
      return -1;
    }
    try {
      FS.mknod(path, mode, dev);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_mkdir__deps: ['__sys_mknod'],
  __sys_mkdir: function(path, mode) {
    // int mkdir(const char *path, mode_t mode);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/mkdir.html
    path = Pointer_stringify(path);
    try {
      FS.mkdir(path, mode, 0);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_chmod__deps: ['$FS', '__setErrNo'],
  __sys_chmod: function(path, mode, dontResolveLastLink) {
    // int chmod(const char *path, mode_t mode);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/chmod.html
    // NOTE: dontResolveLastLink is a shortcut for lchmod(). It should never be
    //       used in client code.
    path = typeof path !== 'string' ? Pointer_stringify(path) : path;
    try {
      FS.chmod(path, mode);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_fchmod__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__sys_chmod'],
  __sys_fchmod: function(fildes, mode) {
    // int fchmod(int fildes, mode_t mode);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/fchmod.html
    try {
      FS.fchmod(fildes, mode);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_fchmodat__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_fchmodat: function(dirfd, pathname, mode, flags) {
    // int fchmodat(int dirfd, const char *pathname, mode_t mode, int flags);
    // http://man7.org/linux/man-pages/man2/fchmodat.2.html
    try {
      FS.fchmodat(dirfd, pathname, mode, flags);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_umask__deps: ['$FS'],
  __sys_umask: function(newMask) {
    // mode_t umask(mode_t cmask);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/umask.html
    // NOTE: This value isn't actually used for anything.
    if (_umask.cmask === undefined) _umask.cmask = 0x1FF;  // S_IRWXU | S_IRWXG | S_IRWXO.
    var oldMask = _umask.cmask;
    _umask.cmask = newMask;
    return oldMask;
  },

  // ==========================================================================
  // sys/statfs.h
  // ==========================================================================

  __statfs_struct_layout: Runtime.generateStructInfo([
    ['i32', 'f_type'],
    ['i32', 'f_bsize'],
    ['i32', 'f_blocks'],
    ['i32', 'f_bfree'],
    ['i32', 'f_bavail'],
    ['i32', 'f_files'],
    ['i32', 'f_ffree'],
    ['i32', 'f_fsid_val0'],
    ['i32', 'f_fsid_val1'],
    ['i32', 'f_namelen'],
    ['i32', 'f_frsize']]),
  __sys_statfs__deps: ['$FS', '__statfs_struct_layout'],
  __sys_statfs: function(path, buf) {
    // http://man7.org/linux/man-pages/man2/statfs.2.html
    // int statfs(const char *path, struct statfs *buf);
    var offsets = ___statfs_struct_layout;
    // NOTE: None of the constants here are true. We're just returning safe and
    //       sane values.
    {{{ makeSetValue('buf', 'offsets.f_type', '0', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_bsize', '4096', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_blocks', '1000000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_bfree', '500000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_bavail', '500000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_files', 'FS.nextInode', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_ffree', '1000000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_fsid_val0', '0', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_fsid_val1', '0', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_namelen', '255', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_frsize', '4096', 'i32') }}}
    return 0;
  },
  __sys_fstatfs__deps: ['__sys_statfs'],
  __sys_fstatfs: function(fildes, buf) {
    // http://man7.org/linux/man-pages/man2/statfs.2.html
    // int fstatfs(int fd, struct statfs *buf);
    return ___sys_statfs(0, buf);
  },

  // ==========================================================================
  // fcntl.h
  // ==========================================================================

  __flock_struct_layout: Runtime.generateStructInfo([
    ['i16', 'l_type'],
    ['i16', 'l_whence'],
    ['i32', 'l_start'],
    ['i32', 'l_len'],
    ['i16', 'l_pid'],
    ['i16', 'l_xxx']]),
  __sys_open__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_open: function(path, oflag, mode) {
    // int open(const char *path, int oflag, ...);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/open.html
   path = Pointer_stringify(path);
    try {
      var stream = FS.open(path, oflag, mode);
      return stream.fd;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_fcntl__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__flock_struct_layout'],
  __sys_fcntl: function(fildes, cmd, varargs, dup2) {
    // int fcntl(int fildes, int cmd, ...);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/fcntl.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    switch (cmd) {
      case {{{ cDefine('F_DUPFD') }}}:
        var arg = {{{ makeGetValue('varargs', 0, 'i32') }}};
        if (arg < 0) {
          ___setErrNo(ERRNO_CODES.EINVAL);
          return -1;
        }
        var newStream;
        try {
          newStream = FS.open(stream.path, stream.flags, 0, arg);
        } catch (e) {
          FS.handleFSError(e);
          return -1;
        }
        return newStream.fd;
      case {{{ cDefine('F_GETFD') }}}:
      case {{{ cDefine('F_SETFD') }}}:
        return 0;  // FD_CLOEXEC makes no sense for a single process.
      case {{{ cDefine('F_GETFL') }}}:
        return stream.flags;
      case {{{ cDefine('F_SETFL') }}}:
        var arg = {{{ makeGetValue('varargs', 0, 'i32') }}};
        stream.flags |= arg;
        return 0;
      case {{{ cDefine('F_GETLK') }}}:
      case {{{ cDefine('F_GETLK64') }}}:
        var arg = {{{ makeGetValue('varargs', 0, 'i32') }}};
        var offset = ___flock_struct_layout.l_type;
        // We're always unlocked.
        {{{ makeSetValue('arg', 'offset', cDefine('F_UNLCK'), 'i16') }}}
        return 0;
      case {{{ cDefine('F_SETLK') }}}:
      case {{{ cDefine('F_SETLKW') }}}:
      case {{{ cDefine('F_SETLK64') }}}:
      case {{{ cDefine('F_SETLKW64') }}}:
        // Pretend that the locking is successful.
        return 0;
      case {{{ cDefine('F_SETOWN') }}}:
      case {{{ cDefine('F_GETOWN') }}}:
        // These are for sockets. We don't have them fully implemented yet.
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
      default:
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
    }
    // Should never be reached. Only to silence strict warnings.
    return -1;
  },
  __sys_posix_fadvise: function(fd, offset, len, advice) {
    // int posix_fadvise(int fd, off_t offset, off_t len, int advice);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/posix_fadvise.html
    // Advise as much as you wish. We don't care.
    return 0;
  },
  __sys_posix_madvise: 'posix_fadvise',
  __sys_posix_fallocate__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_posix_fallocate: function(fd, offset, len) {
    // int posix_fallocate(int fd, off_t offset, off_t len);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/posix_fallocate.html
    var stream = FS.getStream(fd);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    try {
      FS.allocate(stream, offset, len);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },

  // ==========================================================================
  // poll.h
  // ==========================================================================

  __pollfd_struct_layout: Runtime.generateStructInfo([
    ['i32', 'fd'],
    ['i16', 'events'],
    ['i16', 'revents']]),
  __sys_poll__deps: ['$FS', '__pollfd_struct_layout'],
  __sys_poll: function(fds, nfds, timeout) {
    // int poll(struct pollfd fds[], nfds_t nfds, int timeout);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/poll.html
    // NOTE: This is pretty much a no-op mimicking glibc.
    var offsets = ___pollfd_struct_layout;
    var nonzero = 0;
    for (var i = 0; i < nfds; i++) {
      var pollfd = fds + ___pollfd_struct_layout.__size__ * i;
      var fd = {{{ makeGetValue('pollfd', 'offsets.fd', 'i32') }}};
      var events = {{{ makeGetValue('pollfd', 'offsets.events', 'i16') }}};
      var revents = 0;
      var stream = FS.getStream(fd);
      if (stream) {
        if (events & {{{ cDefine('POLLIN') }}}) revents |= {{{ cDefine('POLLIN') }}};
        if (events & {{{ cDefine('POLLOUT') }}}) revents |= {{{ cDefine('POLLOUT') }}};
      } else {
        if (events & {{{ cDefine('POLLNVAL') }}}) revents |= {{{ cDefine('POLLNVAL') }}};
      }
      if (revents) nonzero++;
      {{{ makeSetValue('pollfd', 'offsets.revents', 'revents', 'i16') }}}
    }
    return nonzero;
  },

  // ==========================================================================
  // unistd.h
  // ==========================================================================

  __sys_access__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_access: function(path, amode) {
    // int access(const char *path, int amode);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/access.html
    path = Pointer_stringify(path);
    if (amode & ~{{{ cDefine('S_IRWXO') }}}) {
      // need a valid mode
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    var node;
    try {
      var lookup = FS.lookupPath(path, { follow: true });
      node = lookup.node;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
    var perms = '';
    if (amode & {{{ cDefine('R_OK') }}}) perms += 'r';
    if (amode & {{{ cDefine('W_OK') }}}) perms += 'w';
    if (amode & {{{ cDefine('X_OK') }}}) perms += 'x';
    if (perms /* otherwise, they've just passed F_OK */ && FS.nodePermissions(node, perms)) {
      ___setErrNo(ERRNO_CODES.EACCES);
      return -1;
    }
    return 0;
  },
  __sys_chdir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_chdir: function(path) {
    // int chdir(const char *path);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/chdir.html
    // NOTE: The path argument may be a string, to simplify fchdir().
    if (typeof path !== 'string') path = Pointer_stringify(path);
    var lookup;
    try {
      lookup = FS.lookupPath(path, { follow: true });
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
    if (!FS.isDir(lookup.node.mode)) {
      ___setErrNo(ERRNO_CODES.ENOTDIR);
      return -1;
    }
    var err = FS.nodePermissions(lookup.node, 'x');
    if (err) {
      ___setErrNo(err);
      return -1;
    }
    FS.currentPath = lookup.path;
    return 0;
  },
  __sys_chown__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_chown: function(path, owner, group, dontResolveLastLink) {
    // int chown(const char *path, uid_t owner, gid_t group);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/chown.html
    // We don't support multiple users, so changing ownership makes no sense.
    // NOTE: The path argument may be a string, to simplify fchown().
    // NOTE: dontResolveLastLink is a shortcut for lchown(). It should never be
    //       used in client code.
    if (typeof path !== 'string') path = Pointer_stringify(path);
    try {
      FS.chown(path, owner, group);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_close__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_close: function(fildes) {
    // int close(int fildes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/close.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    try {
      FS.close(stream);
      return 0;
    } catch (e) {
      FS.handleFSError(e);;
      return -1;
    }
  },
  __sys_dup__deps: ['fcntl'],
  __sys_dup: function(fildes) {
    // int dup(int fildes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/dup.html
    return ___sys_fcntl(fildes, 0, allocate([0, 0, 0, 0], 'i32', ALLOC_STACK));  // F_DUPFD.
  },
  __sys_dup2__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__sys_fcntl', '__sys_close'],
  __sys_dup2: function(fildes, fildes2) {
    // int dup2(int fildes, int fildes2);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/dup.html
    var stream = FS.getStream(fildes);
    if (fildes2 < 0) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    } else if (fildes === fildes2 && stream) {
      return fildes;
    } else {
      ___sys_close(fildes2);
      try {
        var stream2 = FS.open(stream.path, stream.flags, 0, fildes2, fildes2);
        return stream2.fd;
      } catch (e) {
        FS.handleFSError(e);
        return -1;
      }
    }
  },
  __sys_fchown__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__sys_chown'],
  __sys_fchown: function(fildes, owner, group) {
    // int fchown(int fildes, uid_t owner, gid_t group);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fchown.html
    try {
      FS.fchown(fildes, owner, group);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_fchdir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__sys_chdir'],
  __sys_fchdir: function(fildes) {
    // int fchdir(int fildes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fchdir.html
    var stream = FS.getStream(fildes);
    if (stream) {
      return _chdir(stream.path);
    } else {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
  },
  __sys_fsync__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_fsync: function(fildes) {
    // int fsync(int fildes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fsync.html
    var stream = FS.getStream(fildes);
    if (stream) {
      // We write directly to the file system, so there's nothing to do here.
      return 0;
    } else {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
  },
  __sys_truncate__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_truncate: function(path, length) {
    // int truncate(const char *path, off_t length);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/truncate.html
    // NOTE: The path argument may be a string, to simplify ftruncate().
    if (typeof path !== 'string') path = Pointer_stringify(path);
    try {
      FS.truncate(path, length);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_ftruncate__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__sys_truncate'],
  __sys_ftruncate: function(fildes, length) {
    // int ftruncate(int fildes, off_t length);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/ftruncate.html
    try {
      FS.ftruncate(fildes, length);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_getcwd__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_getcwd: function(buf, size) {
    // char *getcwd(char *buf, size_t size);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getcwd.html
    if (size == 0) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return 0;
    } else if (size < FS.currentPath.length + 1) {
      ___setErrNo(ERRNO_CODES.ERANGE);
      return 0;
    } else {
      for (var i = 0; i < FS.currentPath.length; i++) {
        {{{ makeSetValue('buf', 'i', 'FS.currentPath.charCodeAt(i)', 'i8') }}}
      }
      {{{ makeSetValue('buf', 'i', '0', 'i8') }}}
      return buf;
    }
  },
  __sys_lchown__deps: ['chown'],
  __sys_lchown: function(path, owner, group) {
    // int lchown(const char *path, uid_t owner, gid_t group);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/lchown.html
    return ___sys_chown(path, owner, group, true);
  },
  __sys_link__deps: ['__setErrNo', '$ERRNO_CODES'],
  __sys_link: function(path1, path2) {
    // int link(const char *path1, const char *path2);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/link.html
    // We don't support hard links.
    ___setErrNo(ERRNO_CODES.EMLINK);
    return -1;
  },
  __sys_lseek__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_lseek: function(fildes, offset, whence) {
    // off_t lseek(int fildes, off_t offset, int whence);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/lseek.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    try {
      return FS.llseek(stream, offset, whence);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_pread__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_pread: function(fildes, buf, nbyte, offset) {
    // ssize_t pread(int fildes, void *buf, size_t nbyte, off_t offset);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/read.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    try {
      var slab = {{{ makeGetSlabs('buf', 'i8', true) }}};
#if SAFE_HEAP
#if USE_TYPED_ARRAYS == 0
      SAFE_HEAP_FILL_HISTORY(buf, buf+nbyte, 'i8'); // VFS does not use makeSetValues, so we need to do it manually
#endif
#endif
      return FS.read(stream, slab, buf, nbyte, offset);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_read__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__sys_recv', '__sys_pread'],
  __sys_read: function(fildes, buf, nbyte) {
    // ssize_t read(int fildes, void *buf, size_t nbyte);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/read.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    if (stream && ('socket' in stream)) {
      return ___sys_recv(fildes, buf, nbyte, 0);
    }

    try {
      var slab = {{{ makeGetSlabs('buf', 'i8', true) }}};
#if SAFE_HEAP
#if USE_TYPED_ARRAYS == 0
      SAFE_HEAP_FILL_HISTORY(buf, buf+nbyte, 'i8'); // VFS does not use makeSetValues, so we need to do it manually
#endif
#endif
      return FS.read(stream, slab, buf, nbyte);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_rmdir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_rmdir: function(path) {
    // int rmdir(const char *path);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/rmdir.html
    path = Pointer_stringify(path);
    try {
      FS.rmdir(path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_unlink__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_unlink: function(path) {
    // int unlink(const char *path);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/unlink.html
    path = Pointer_stringify(path);
    try {
      FS.unlink(path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_symlink__deps: ['$FS', '$PATH', '__setErrNo', '$ERRNO_CODES'],
  __sys_symlink: function(path1, path2) {
    // int symlink(const char *path1, const char *path2);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/symlink.html
    path1 = Pointer_stringify(path1);
    path2 = Pointer_stringify(path2);
    try {
      FS.symlink(path1, path2);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_readlink__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_readlink: function(path, buf, bufsize) {
    // ssize_t readlink(const char *restrict path, char *restrict buf, size_t bufsize);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/readlink.html
    path = Pointer_stringify(path);
    var str;
    try {
      str = FS.readlink(path);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
    str = str.slice(0, Math.max(0, bufsize - 1));
    writeStringToMemory(str, buf, true);
    return str.length;
  },
  __sys_pwrite__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  __sys_pwrite: function(fildes, buf, nbyte, offset) {
    // ssize_t pwrite(int fildes, const void *buf, size_t nbyte, off_t offset);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/write.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    try {
      var slab = {{{ makeGetSlabs('buf', 'i8', true) }}};
#if SAFE_HEAP
#if USE_TYPED_ARRAYS == 0
      SAFE_HEAP_FILL_HISTORY(buf, buf+nbyte, 'i8'); // VFS does not use makeSetValues, so we need to do it manually
#endif
#endif
      return FS.write(stream, slab, buf, nbyte, offset);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_write__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__sys_send', '__sys_pwrite'],
  __sys_write: function(fildes, buf, nbyte) {
    // ssize_t write(int fildes, const void *buf, size_t nbyte);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/write.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    if (stream && ('socket' in stream)) {
      return ___sys_send(fildes, buf, nbyte, 0);
    }

    try {
      var slab = {{{ makeGetSlabs('buf', 'i8', true) }}};
#if SAFE_HEAP
#if USE_TYPED_ARRAYS == 0
      SAFE_HEAP_FILL_HISTORY(buf, buf+nbyte, 'i8'); // VFS does not use makeSetValues, so we need to do it manually
#endif
#endif
      return FS.write(stream, slab, buf, nbyte);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  __sys_execve__deps: ['__setErrNo', '$ERRNO_CODES'],
  __sys_execve: function(filename, argv, envp) {
    // int execve(const char *filename, char *const argv[], char *const envp[]);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/exec.html
    // We don't support executing external code.
    ___setErrNo(ERRNO_CODES.ENOEXEC);
    return -1;
  },
  __sys_exit: function(status) {
    // void _exit(int status);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/exit.html
    Module.print('exit(' + status + ') called');
    Module['exit'](status);
  },
  __sys_getgid: function() {
    // gid_t getgid(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getgid.html
    // We have just one process/group/user, all with ID 0.
    return 0;
  },
  __sys_getegid: '__sys_getgid',
  __sys_getuid: '__sys_getgid',
  __sys_geteuid: '__sys_getgid',
  __sys_getpgrp: '__sys_getgid',
  __sys_getpid: '__sys_getgid',
  __sys_getppid: '__sys_getgid',
  __sys_getresuid: function(ruid, euid, suid) {
    // int getresuid(uid_t *ruid, uid_t *euid, uid_t *suid);
    // http://linux.die.net/man/2/getresuid
    // We have just one process/group/user, all with ID 0.
    {{{ makeSetValue('ruid', '0', '0', 'i32') }}}
    {{{ makeSetValue('euid', '0', '0', 'i32') }}}
    {{{ makeSetValue('suid', '0', '0', 'i32') }}}
    return 0;
  },
  __sys_getresgid: '__sys_getresuid',
  __sys_getgroups__deps: ['__setErrNo', '$ERRNO_CODES'],
  __sys_getgroups: function(gidsetsize, grouplist) {
    // int getgroups(int gidsetsize, gid_t grouplist[]);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getgroups.html
    if (gidsetsize < 1) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    } else {
      {{{ makeSetValue('grouplist', '0', '0', 'i32') }}}
      return 1;
    }
  },
  __sys_setgroups__deps: ['__setErrNo', '$ERRNO_CODES', 'sysconf'],
  __sys_setgroups: function(ngroups, gidset) {
    // int setgroups(int ngroups, const gid_t *gidset);
    // https://developer.apple.com/library/mac/#documentation/Darwin/Reference/ManPages/man2/setgroups.2.html
    if (ngroups < 1 || ngroups > _sysconf({{{ cDefine('_SC_NGROUPS_MAX') }}})) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    } else {
      // We have just one process/user/group, so it makes no sense to set groups.
      ___setErrNo(ERRNO_CODES.EPERM);
      return -1;
    }
  },
  __sys_getpgid: function(pid) {
    // pid_t getpgid(pid_t pid);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getpgid.html
    // There can only be one process, and its group ID is 0.
    return 0;
  },
  __sys_getsid: '__sys_getpgid',
  __sys_setgid__deps: ['__setErrNo', '$ERRNO_CODES'],
  __sys_setgid: function(gid) {
    // int setgid(gid_t gid);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/setgid.html
    // We have just one process/group/user, so it makes no sense to set IDs.
    ___setErrNo(ERRNO_CODES.EPERM);
    return -1;
  },
  __sys_setegid: '__sys_setgid',
  __sys_setuid: '__sys_setgid',
  __sys_seteuid: '__sys_setgid',
  __sys_setsid: '__sys_setgid',
  __sys_setpgrp: '__sys_setgid',
  __sys_setpgid__deps: ['__setErrNo', '$ERRNO_CODES'],
  __sys_setpgid: function(pid, pgid) {
    // int setpgid(pid_t pid, pid_t pgid);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getpgid.html
    // We have just one process/group/user, so it makes no sense to set IDs.
    ___setErrNo(ERRNO_CODES.EPERM);
    return -1;
  },
  __sys_setregid: '__sys_setpgid',
  __sys_setreuid: '__sys_setpgid',
  // NOTE: These do not match the signatures, but they all use the same stub.
  __sys_setresuid: '__sys_setpgid',
  __sys_setresgid: '__sys_setpgid',
  __timespec_struct_layout: Runtime.generateStructInfo([
    ['i32', 'tv_sec'],
    ['i32', 'tv_nsec']]),
  __sys_nanosleep__deps: ['__timespec_struct_layout'],
  __sys_nanosleep: function(rqtp, rmtp) {
    // int nanosleep(const struct timespec  *rqtp, struct timespec *rmtp);
    var seconds = {{{ makeGetValue('rqtp', '___timespec_struct_layout.tv_sec', 'i32') }}};
    var nanoseconds = {{{ makeGetValue('rqtp', '___timespec_struct_layout.tv_nsec', 'i32') }}};
    {{{ makeSetValue('rmtp', '___timespec_struct_layout.tv_sec', '0', 'i32') }}}
    {{{ makeSetValue('rmtp', '___timespec_struct_layout.tv_nsec', '0', 'i32') }}}
    var msec = (seconds * 1000) + (nanoseconds / 1e6);

    // We're single-threaded, so use a busy loop. Super-ugly.
    if (ENVIRONMENT_IS_WEB && window['performance'] && window['performance']['now']) {
      var start = window['performance']['now']();
      while (window['performance']['now']() - start < msec) {
        // Do nothing.
      }
    } else {
      var start = Date.now();
      while (Date.now() - start < msec) {
        // Do nothing.
      }
    }
    return 0;
  },
  __sys_brk: function(addr) {
    // Implement a Linux-like 'memory area' for our 'process'.
    // Changes the size of the memory area by |bytes|; returns the
    // address of the previous top ('break') of the memory area
    // We control the "dynamic" memory - DYNAMIC_BASE to DYNAMICTOP
    if (addr == 0) return DYNAMICTOP;
    
    var self = ___sys_brk;
    if (!self.called) {
      DYNAMICTOP = alignMemoryPage(DYNAMICTOP); // make sure we start out aligned
      self.called = true;
      assert(Runtime.dynamicAlloc);
      self.alloc = Runtime.dynamicAlloc;
      Runtime.dynamicAlloc = function() { abort('cannot dynamically allocate, brk now has control') };
    }
    var bytes = addr - DYNAMICTOP;
    if (bytes > 0) self.alloc(bytes);
    return addr;  // Previous break location.
  },

  // ==========================================================================
  // sys/uio.h
  // ==========================================================================

  __sys_readv__deps: ['__sys_read'],
  __sys_readv: function(fd, iov, iovcnt) {
    var total_readed = 0;
    for (var i = 0; i < iovcnt; i++) {
      var buf = {{{ makeGetValue('iov', 'i * 8', 'i32') }}};
      var count = {{{ makeGetValue('iov', 'i * 8 + 4', 'i32') }}};
      var readed = ___sys_read(fd, buf, count);
      if (readed < 0) {
        return readed;
      } else {
        total_readed += readed;
        if (readed != count) { break; }
      }
    }
    return total_readed;
  },

  __sys_writev__deps: ['__sys_write'],
  __sys_writev: function(fd, iov, iovcnt) {
    var total_written = 0;
    for (var i = 0; i < iovcnt; i++) {
      var buf = {{{ makeGetValue('iov', 'i * 8', 'i32') }}};
      var count = {{{ makeGetValue('iov', 'i * 8 + 4', 'i32') }}};
      var written = ___sys_write(fd, buf, count);
      if (written < 0) {
        return written;
      } else {
        total_written += written;
        if (written != count) { break; }
      }
    }
    return total_written;
  },

  // ==========================================================================
  // sys/mman.h
  // ==========================================================================

  __sys_mmap__deps: ['$FS'],
  __sys_mmap: function(start, num, prot, flags, stream, offset) {
    /* FIXME: Since mmap is normally implemented at the kernel level,
     * this implementation simply uses malloc underneath the call to
     * mmap.
     */
    var MAP_PRIVATE = 2;
    var ptr;
    var allocated = false;

    if (!_mmap.mappings) _mmap.mappings = {};

    if (stream == -1) {
      ptr = _malloc(num);
      if (!ptr) return -1;
      _memset(ptr, 0, num);
      allocated = true;
    } else {
      var info = FS.getStream(stream);
      if (!info) return -1;
      try {
        var res = FS.mmap(info, HEAPU8, start, num, offset, prot, flags);
        ptr = res.ptr;
        allocated = res.allocated;
      } catch (e) {
        FS.handleFSError(e);
        return -1;
      }
    }

    _mmap.mappings[ptr] = { malloc: ptr, num: num, allocated: allocated };
    return ptr;
  },
  __sys_munmap: function(start, num) {
    if (!_mmap.mappings) _mmap.mappings = {};
    // TODO: support unmmap'ing parts of allocations
    var info = _mmap.mappings[start];
    if (!info) return 0;
    if (num == info.num) {
      _mmap.mappings[start] = null;
      if (info.allocated) {
        _free(info.malloc);
      }
    }
    return 0;
  },

  // TODO: Implement mremap.

  // ==========================================================================
  // stdlib.h
  // ==========================================================================

  _ZSt9terminatev__deps: ['exit'],
  _ZSt9terminatev: function() {
    _exit(-1234);
  },

  abort: function() {
    Module['abort']();
  },

  _parseInt__deps: ['isspace', '__setErrNo', '$ERRNO_CODES'],
  _parseInt: function(str, endptr, base, min, max, bits, unsign) {
    // Skip space.
    while (_isspace({{{ makeGetValue('str', 0, 'i8') }}})) str++;

    // Check for a plus/minus sign.
    var multiplier = 1;
    if ({{{ makeGetValue('str', 0, 'i8') }}} == {{{ charCode('-') }}}) {
      multiplier = -1;
      str++;
    } else if ({{{ makeGetValue('str', 0, 'i8') }}} == {{{ charCode('+') }}}) {
      str++;
    }

    // Find base.
    var finalBase = base;
    if (!finalBase) {
      if ({{{ makeGetValue('str', 0, 'i8') }}} == {{{ charCode('0') }}}) {
        if ({{{ makeGetValue('str+1', 0, 'i8') }}} == {{{ charCode('x') }}} ||
            {{{ makeGetValue('str+1', 0, 'i8') }}} == {{{ charCode('X') }}}) {
          finalBase = 16;
          str += 2;
        } else {
          finalBase = 8;
          str++;
        }
      }
    } else if (finalBase==16) {
      if ({{{ makeGetValue('str', 0, 'i8') }}} == {{{ charCode('0') }}}) {
        if ({{{ makeGetValue('str+1', 0, 'i8') }}} == {{{ charCode('x') }}} ||
            {{{ makeGetValue('str+1', 0, 'i8') }}} == {{{ charCode('X') }}}) {
          str += 2;
        }
      }
    }
    if (!finalBase) finalBase = 10;

    // Get digits.
    var chr;
    var ret = 0;
    while ((chr = {{{ makeGetValue('str', 0, 'i8') }}}) != 0) {
      var digit = parseInt(String.fromCharCode(chr), finalBase);
      if (isNaN(digit)) {
        break;
      } else {
        ret = ret * finalBase + digit;
        str++;
      }
    }

    // Apply sign.
    ret *= multiplier;

    // Set end pointer.
    if (endptr) {
      {{{ makeSetValue('endptr', 0, 'str', '*') }}}
    }

    // Unsign if needed.
    if (unsign) {
      if (Math.abs(ret) > max) {
        ret = max;
        ___setErrNo(ERRNO_CODES.ERANGE);
      } else {
        ret = unSign(ret, bits);
      }
    }

    // Validate range.
    if (ret > max || ret < min) {
      ret = ret > max ? max : min;
      ___setErrNo(ERRNO_CODES.ERANGE);
    }

#if USE_TYPED_ARRAYS == 2
    if (bits == 64) {
      {{{ makeStructuralReturn(splitI64('ret')) }}};
    }
#endif

    return ret;
  },
#if USE_TYPED_ARRAYS == 2
  _parseInt64__deps: ['isspace', '__setErrNo', '$ERRNO_CODES', function() { Types.preciseI64MathUsed = 1 }],
  _parseInt64: function(str, endptr, base, min, max, unsign) {
    var isNegative = false;
    // Skip space.
    while (_isspace({{{ makeGetValue('str', 0, 'i8') }}})) str++;

    // Check for a plus/minus sign.
    if ({{{ makeGetValue('str', 0, 'i8') }}} == {{{ charCode('-') }}}) {
      str++;
      isNegative = true;
    } else if ({{{ makeGetValue('str', 0, 'i8') }}} == {{{ charCode('+') }}}) {
      str++;
    }

    // Find base.
    var ok = false;
    var finalBase = base;
    if (!finalBase) {
      if ({{{ makeGetValue('str', 0, 'i8') }}} == {{{ charCode('0') }}}) {
        if ({{{ makeGetValue('str+1', 0, 'i8') }}} == {{{ charCode('x') }}} ||
            {{{ makeGetValue('str+1', 0, 'i8') }}} == {{{ charCode('X') }}}) {
          finalBase = 16;
          str += 2;
        } else {
          finalBase = 8;
          ok = true; // we saw an initial zero, perhaps the entire thing is just "0"
        }
      }
    } else if (finalBase==16) {
      if ({{{ makeGetValue('str', 0, 'i8') }}} == {{{ charCode('0') }}}) {
        if ({{{ makeGetValue('str+1', 0, 'i8') }}} == {{{ charCode('x') }}} ||
            {{{ makeGetValue('str+1', 0, 'i8') }}} == {{{ charCode('X') }}}) {
          str += 2;
        }
      }
    }
    if (!finalBase) finalBase = 10;
    start = str;

    // Get digits.
    var chr;
    while ((chr = {{{ makeGetValue('str', 0, 'i8') }}}) != 0) {
      var digit = parseInt(String.fromCharCode(chr), finalBase);
      if (isNaN(digit)) {
        break;
      } else {
        str++;
        ok = true;
      }
    }

    if (!ok) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      {{{ makeStructuralReturn(['0', '0']) }}};
    }

    // Set end pointer.
    if (endptr) {
      {{{ makeSetValue('endptr', 0, 'str', '*') }}}
    }

    try {
      var numberString = isNegative ? '-'+Pointer_stringify(start, str - start) : Pointer_stringify(start, str - start);
      i64Math.fromString(numberString, finalBase, min, max, unsign);
    } catch(e) {
      ___setErrNo(ERRNO_CODES.ERANGE); // not quite correct
    }

    {{{ makeStructuralReturn([makeGetTempDouble(0, 'i32'), makeGetTempDouble(1, 'i32')]) }}};
  },
#endif
  strtoll__deps: ['_parseInt64'],
  strtoll: function(str, endptr, base) {
    return __parseInt64(str, endptr, base, '-9223372036854775808', '9223372036854775807');  // LLONG_MIN, LLONG_MAX.
  },
  strtoll_l: 'strtoll', // no locale support yet
  strtol__deps: ['_parseInt'],
  strtol: function(str, endptr, base) {
    return __parseInt(str, endptr, base, -2147483648, 2147483647, 32);  // LONG_MIN, LONG_MAX.
  },
  strtol_l: 'strtol', // no locale support yet
  strtoul__deps: ['_parseInt'],
  strtoul: function(str, endptr, base) {
    return __parseInt(str, endptr, base, 0, 4294967295, 32, true);  // ULONG_MAX.
  },
  strtoul_l: 'strtoul', // no locale support yet
  strtoull__deps: ['_parseInt64'],
  strtoull: function(str, endptr, base) {
    return __parseInt64(str, endptr, base, 0, '18446744073709551615', true);  // ULONG_MAX.
  },
  strtoull_l: 'strtoull', // no locale support yet

  atoi__deps: ['strtol'],
  atoi: function(ptr) {
    return _strtol(ptr, null, 10);
  },
  atol: 'atoi',

  atoll__deps: ['strtoll'],
  atoll: function(ptr) {
    return _strtoll(ptr, null, 10);
  },

  environ: 'allocate(1, "i32*", ALLOC_STATIC)',
  __environ__deps: ['environ'],
  __environ: '_environ',
  __buildEnvironment__deps: ['__environ'],
  __buildEnvironment: function(env) {
    // WARNING: Arbitrary limit!
    var MAX_ENV_VALUES = 64;
    var TOTAL_ENV_SIZE = 1024;

    // Statically allocate memory for the environment.
    var poolPtr;
    var envPtr;
    if (!___buildEnvironment.called) {
      ___buildEnvironment.called = true;
      // Set default values. Use string keys for Closure Compiler compatibility.
      ENV['USER'] = ENV['LOGNAME'] = 'root';
      ENV['PATH'] = '/';
      ENV['PWD'] = '/';
      ENV['HOME'] = '/home/emscripten';
      ENV['LANG'] = 'en_US.UTF-8';
      ENV['_'] = './this.program';
      // Allocate memory.
      poolPtr = allocate(TOTAL_ENV_SIZE, 'i8', ALLOC_STATIC);
      envPtr = allocate(MAX_ENV_VALUES * {{{ Runtime.QUANTUM_SIZE }}},
                        'i8*', ALLOC_STATIC);
      {{{ makeSetValue('envPtr', '0', 'poolPtr', 'i8*') }}}
      {{{ makeSetValue(makeGlobalUse('_environ'), 0, 'envPtr', 'i8*') }}};
    } else {
      envPtr = {{{ makeGetValue(makeGlobalUse('_environ'), '0', 'i8**') }}};
      poolPtr = {{{ makeGetValue('envPtr', '0', 'i8*') }}};
    }

    // Collect key=value lines.
    var strings = [];
    var totalSize = 0;
    for (var key in env) {
      if (typeof env[key] === 'string') {
        var line = key + '=' + env[key];
        strings.push(line);
        totalSize += line.length;
      }
    }
    if (totalSize > TOTAL_ENV_SIZE) {
      throw new Error('Environment size exceeded TOTAL_ENV_SIZE!');
    }

    // Make new.
    var ptrSize = {{{ Runtime.getNativeTypeSize('i8*') }}};
    for (var i = 0; i < strings.length; i++) {
      var line = strings[i];
      for (var j = 0; j < line.length; j++) {
        {{{ makeSetValue('poolPtr', 'j', 'line.charCodeAt(j)', 'i8') }}};
      }
      {{{ makeSetValue('poolPtr', 'j', '0', 'i8') }}};
      {{{ makeSetValue('envPtr', 'i * ptrSize', 'poolPtr', 'i8*') }}};
      poolPtr += line.length + 1;
    }
    {{{ makeSetValue('envPtr', 'strings.length * ptrSize', '0', 'i8*') }}};
  },
  $ENV__deps: ['__buildEnvironment'],
  $ENV__postset: '___buildEnvironment(ENV);',
  $ENV: {},

  getloadavg: function(loadavg, nelem) {
    // int getloadavg(double loadavg[], int nelem);
    // http://linux.die.net/man/3/getloadavg
    var limit = Math.min(nelem, 3);
    var doubleSize = {{{ Runtime.getNativeTypeSize('double') }}};
    for (var i = 0; i < limit; i++) {
      {{{ makeSetValue('loadavg', 'i * doubleSize', '0.1', 'double') }}}
    }
    return limit;
  },

  // Use browser's Math.random(). We can't set a seed, though.
  srand: function(seed) {}, // XXX ignored
  rand: function() {
    return Math.floor(Math.random()*0x80000000);
  },
  rand_r: function(seed) { // XXX ignores the seed
    return Math.floor(Math.random()*0x80000000);
  },
  drand48: function() {
    return Math.random();
  },
  arc4random: 'rand',

  // ==========================================================================
  // string.h
  // ==========================================================================

  // FIXME: memcpy, memmove and memset should all return their destination pointers.

  memcpy__inline: function(dest, src, num, align) {
    var ret = '';
#if ASSERTIONS
#if ASM_JS == 0
    ret += "assert(" + num + " % 1 === 0);"; //, 'memcpy given ' + " + num + " + ' bytes to copy. Problem with quantum=1 corrections perhaps?');";
#endif
#endif
    ret += makeCopyValues(dest, src, num, 'null', null, align);
    return ret;
  },

  memcpy__asm: true,
  memcpy__sig: 'iiii',
  memcpy: function(dest, src, num) {
    dest = dest|0; src = src|0; num = num|0;
    var ret = 0;
    ret = dest|0;
    if ((dest&3) == (src&3)) {
      while (dest & 3) {
        if ((num|0) == 0) return ret|0;
        {{{ makeSetValueAsm('dest', 0, makeGetValueAsm('src', 0, 'i8'), 'i8') }}};
        dest = (dest+1)|0;
        src = (src+1)|0;
        num = (num-1)|0;
      }
      while ((num|0) >= 4) {
        {{{ makeSetValueAsm('dest', 0, makeGetValueAsm('src', 0, 'i32'), 'i32') }}};
        dest = (dest+4)|0;
        src = (src+4)|0;
        num = (num-4)|0;
      }
    }
    while ((num|0) > 0) {
      {{{ makeSetValueAsm('dest', 0, makeGetValueAsm('src', 0, 'i8'), 'i8') }}};
      dest = (dest+1)|0;
      src = (src+1)|0;
      num = (num-1)|0;
    }
    return ret|0;
  },

  llvm_memcpy_i32: 'memcpy',
  llvm_memcpy_i64: 'memcpy',
  llvm_memcpy_p0i8_p0i8_i32: 'memcpy',
  llvm_memcpy_p0i8_p0i8_i64: 'memcpy',

  memmove__sig: 'viii',
  memmove__asm: true,
  memmove__deps: ['memcpy'],
  memmove: function(dest, src, num) {
    dest = dest|0; src = src|0; num = num|0;
    if (((src|0) < (dest|0)) & ((dest|0) < ((src + num)|0))) {
      // Unlikely case: Copy backwards in a safe manner
      src = (src + num)|0;
      dest = (dest + num)|0;
      while ((num|0) > 0) {
        dest = (dest - 1)|0;
        src = (src - 1)|0;
        num = (num - 1)|0;
        {{{ makeSetValueAsm('dest', 0, makeGetValueAsm('src', 0, 'i8'), 'i8') }}};
      }
    } else {
      _memcpy(dest, src, num) | 0;
    }
  },
  llvm_memmove_i32: 'memmove',
  llvm_memmove_i64: 'memmove',
  llvm_memmove_p0i8_p0i8_i32: 'memmove',
  llvm_memmove_p0i8_p0i8_i64: 'memmove',

  memset__inline: function(ptr, value, num, align) {
    return makeSetValues(ptr, 0, value, 'null', num, align);
  },
  memset__sig: 'viii',
  memset__asm: true,
  memset: function(ptr, value, num) {
#if USE_TYPED_ARRAYS == 2
    ptr = ptr|0; value = value|0; num = num|0;
    var stop = 0, value4 = 0, stop4 = 0, unaligned = 0;
    stop = (ptr + num)|0;
    if ((num|0) >= {{{ Math.round(2.5*UNROLL_LOOP_MAX) }}}) {
      // This is unaligned, but quite large, so work hard to get to aligned settings
      value = value & 0xff;
      unaligned = ptr & 3;
      value4 = value | (value << 8) | (value << 16) | (value << 24);
      stop4 = stop & ~3;
      if (unaligned) {
        unaligned = (ptr + 4 - unaligned)|0;
        while ((ptr|0) < (unaligned|0)) { // no need to check for stop, since we have large num
          {{{ makeSetValueAsm('ptr', 0, 'value', 'i8') }}};
          ptr = (ptr+1)|0;
        }
      }
      while ((ptr|0) < (stop4|0)) {
        {{{ makeSetValueAsm('ptr', 0, 'value4', 'i32') }}};
        ptr = (ptr+4)|0;
      }
    }
    while ((ptr|0) < (stop|0)) {
      {{{ makeSetValueAsm('ptr', 0, 'value', 'i8') }}};
      ptr = (ptr+1)|0;
    }
#else
    {{{ makeSetValues('ptr', '0', 'value', 'null', 'num') }}};
#endif
  },
  llvm_memset_i32: 'memset',
  llvm_memset_p0i8_i32: 'memset',
  llvm_memset_p0i8_i64: 'memset',

  strlen__sig: 'ii',
  strlen__asm: true,
  strlen: function(ptr) {
    ptr = ptr|0;
    var curr = 0;
    curr = ptr;
    while ({{{ makeGetValueAsm('curr', '0', 'i8') }}}) {
      curr = (curr + 1)|0;
    }
    return (curr - ptr)|0;
  },

  strcpy__asm: true,
  strcpy__sig: 'iii',
  strcpy: function(pdest, psrc) {
    pdest = pdest|0; psrc = psrc|0;
    var i = 0;
    do {
      {{{ makeCopyValues('(pdest+i)|0', '(psrc+i)|0', 1, 'i8', null, 1) }}};
      i = (i+1)|0;
    } while ({{{ makeGetValueAsm('psrc', 'i-1', 'i8') }}});
    return pdest|0;
  },

  stpcpy: function(pdest, psrc) {
    var i = 0;
    do {
      {{{ makeCopyValues('pdest+i', 'psrc+i', 1, 'i8', null, 1) }}};
      i ++;
    } while ({{{ makeGetValue('psrc', 'i-1', 'i8') }}} != 0);
    return pdest + i - 1;
  },

  strncpy__asm: true,
  strncpy__sig: 'iiii',
  strncpy: function(pdest, psrc, num) {
    pdest = pdest|0; psrc = psrc|0; num = num|0;
    var padding = 0, curr = 0, i = 0;
    while ((i|0) < (num|0)) {
      curr = padding ? 0 : {{{ makeGetValueAsm('psrc', 'i', 'i8') }}};
      {{{ makeSetValue('pdest', 'i', 'curr', 'i8') }}}
      padding = padding ? 1 : ({{{ makeGetValueAsm('psrc', 'i', 'i8') }}} == 0);
      i = (i+1)|0;
    }
    return pdest|0;
  },

  strcat__asm: true,
  strcat__sig: 'iii',
  strcat__deps: ['strlen'],
  strcat: function(pdest, psrc) {
    pdest = pdest|0; psrc = psrc|0;
    var i = 0;
    var pdestEnd = 0;
    pdestEnd = (pdest + (_strlen(pdest)|0))|0;
    do {
      {{{ makeCopyValues('pdestEnd+i', 'psrc+i', 1, 'i8', null, 1) }}};
      i = (i+1)|0;
    } while ({{{ makeGetValueAsm('psrc', 'i-1', 'i8') }}});
    return pdest|0;
  },

  strcmp__deps: ['strncmp'],
  strcmp: function(px, py) {
    return _strncmp(px, py, TOTAL_MEMORY);
  },
  // We always assume ASCII locale.
  strcoll: 'strcmp',

  strcasecmp__asm: true,
  strcasecmp__sig: 'iii',
  strcasecmp__deps: ['strncasecmp'],
  strcasecmp: function(px, py) {
    px = px|0; py = py|0;
    return _strncasecmp(px, py, -1)|0;
  },

  strncmp: function(px, py, n) {
    var i = 0;
    while (i < n) {
      var x = {{{ makeGetValue('px', 'i', 'i8', 0, 1) }}};
      var y = {{{ makeGetValue('py', 'i', 'i8', 0, 1) }}};
      if (x == y && x == 0) return 0;
      if (x == 0) return -1;
      if (y == 0) return 1;
      if (x == y) {
        i ++;
        continue;
      } else {
        return x > y ? 1 : -1;
      }
    }
    return 0;
  },

  strncasecmp__asm: true,
  strncasecmp__sig: 'iiii',
  strncasecmp__deps: ['tolower'],
  strncasecmp: function(px, py, n) {
    px = px|0; py = py|0; n = n|0;
    var i = 0, x = 0, y = 0;
    while ((i>>>0) < (n>>>0)) {
      x = _tolower({{{ makeGetValueAsm('px', 'i', 'i8', 0, 1) }}})|0;
      y = _tolower({{{ makeGetValueAsm('py', 'i', 'i8', 0, 1) }}})|0;
      if (((x|0) == (y|0)) & ((x|0) == 0)) return 0;
      if ((x|0) == 0) return -1;
      if ((y|0) == 0) return 1;
      if ((x|0) == (y|0)) {
        i = (i + 1)|0;
        continue;
      } else {
        return ((x>>>0) > (y>>>0) ? 1 : -1)|0;
      }
    }
    return 0;
  },

  memcmp__asm: true,
  memcmp__sig: 'iiii',
  memcmp: function(p1, p2, num) {
    p1 = p1|0; p2 = p2|0; num = num|0;
    var i = 0, v1 = 0, v2 = 0;
    while ((i|0) < (num|0)) {
      var v1 = {{{ makeGetValueAsm('p1', 'i', 'i8', true) }}};
      var v2 = {{{ makeGetValueAsm('p2', 'i', 'i8', true) }}};
      if ((v1|0) != (v2|0)) return ((v1|0) > (v2|0) ? 1 : -1)|0;
      i = (i+1)|0;
    }
    return 0;
  },

  // ==========================================================================
  // ctype.h
  // ==========================================================================

  // Lookup tables for glibc ctype implementation.
  __ctype_b_loc: function() {
    // http://refspecs.freestandards.org/LSB_3.0.0/LSB-Core-generic/LSB-Core-generic/baselib---ctype-b-loc.html
    var me = ___ctype_b_loc;
    if (!me.ret) {
      var values = [
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,2,2,2,2,2,2,2,2,2,8195,8194,8194,8194,8194,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,24577,49156,49156,49156,
        49156,49156,49156,49156,49156,49156,49156,49156,49156,49156,49156,49156,55304,55304,55304,55304,55304,55304,55304,55304,
        55304,55304,49156,49156,49156,49156,49156,49156,49156,54536,54536,54536,54536,54536,54536,50440,50440,50440,50440,50440,
        50440,50440,50440,50440,50440,50440,50440,50440,50440,50440,50440,50440,50440,50440,50440,49156,49156,49156,49156,49156,
        49156,54792,54792,54792,54792,54792,54792,50696,50696,50696,50696,50696,50696,50696,50696,50696,50696,50696,50696,50696,
        50696,50696,50696,50696,50696,50696,50696,49156,49156,49156,49156,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
      ];
      var i16size = {{{ Runtime.getNativeTypeSize('i16') }}};
      var arr = _malloc(values.length * i16size);
      for (var i = 0; i < values.length; i++) {
        {{{ makeSetValue('arr', 'i * i16size', 'values[i]', 'i16') }}}
      }
      me.ret = allocate([arr + 128 * i16size], 'i16*', ALLOC_NORMAL);
    }
    return me.ret;
  },
  __ctype_tolower_loc: function() {
    // http://refspecs.freestandards.org/LSB_3.1.1/LSB-Core-generic/LSB-Core-generic/libutil---ctype-tolower-loc.html
    var me = ___ctype_tolower_loc;
    if (!me.ret) {
      var values = [
        128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,
        158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,
        188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,
        218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,
        248,249,250,251,252,253,254,-1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,
        33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,97,98,99,100,101,102,103,
        104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,91,92,93,94,95,96,97,98,99,100,101,102,103,
        104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,
        134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,
        164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,
        194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,
        224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,
        254,255
      ];
      var i32size = {{{ Runtime.getNativeTypeSize('i32') }}};
      var arr = _malloc(values.length * i32size);
      for (var i = 0; i < values.length; i++) {
        {{{ makeSetValue('arr', 'i * i32size', 'values[i]', 'i32') }}}
      }
      me.ret = allocate([arr + 128 * i32size], 'i32*', ALLOC_NORMAL);
    }
    return me.ret;
  },
  __ctype_toupper_loc: function() {
    // http://refspecs.freestandards.org/LSB_3.1.1/LSB-Core-generic/LSB-Core-generic/libutil---ctype-toupper-loc.html
    var me = ___ctype_toupper_loc;
    if (!me.ret) {
      var values = [
        128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,
        158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,
        188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,
        218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,
        248,249,250,251,252,253,254,-1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,
        33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,
        73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,
        81,82,83,84,85,86,87,88,89,90,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,
        145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,
        175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,
        205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,
        235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255
      ];
      var i32size = {{{ Runtime.getNativeTypeSize('i32') }}};
      var arr = _malloc(values.length * i32size);
      for (var i = 0; i < values.length; i++) {
        {{{ makeSetValue('arr', 'i * i32size', 'values[i]', 'i32') }}}
      }
      me.ret = allocate([arr + 128 * i32size], 'i32*', ALLOC_NORMAL);
    }
    return me.ret;
  },

  // ==========================================================================
  // LLVM specifics
  // ==========================================================================

  llvm_va_start__inline: function(ptr) {
    // varargs - we received a pointer to the varargs as a final 'extra' parameter called 'varrp'
#if TARGET_X86
    return makeSetValue(ptr, 0, 'varrp', 'void*');
#endif
#if TARGET_LE32
    // 2-word structure: struct { void* start; void* currentOffset; }
    return makeSetValue(ptr, 0, 'varrp', 'void*') + ';' + makeSetValue(ptr, Runtime.QUANTUM_SIZE, 0, 'void*');
#endif
  },

  llvm_va_end: function() {},

  llvm_va_copy: function(ppdest, ppsrc) {
    // copy the list start
    {{{ makeCopyValues('ppdest', 'ppsrc', Runtime.QUANTUM_SIZE, 'null', null, 1) }}};
    
    // copy the list's current offset (will be advanced with each call to va_arg)
    {{{ makeCopyValues('(ppdest+'+Runtime.QUANTUM_SIZE+')', '(ppsrc+'+Runtime.QUANTUM_SIZE+')', Runtime.QUANTUM_SIZE, 'null', null, 1) }}};
  },

  llvm_bswap_i16: function(x) {
    return ((x&0xff)<<8) | ((x>>8)&0xff);
  },

  llvm_bswap_i32: function(x) {
    return ((x&0xff)<<24) | (((x>>8)&0xff)<<16) | (((x>>16)&0xff)<<8) | (x>>>24);
  },

  llvm_bswap_i64__deps: ['llvm_bswap_i32'],
  llvm_bswap_i64: function(l, h) {
    var retl = _llvm_bswap_i32(h)>>>0;
    var reth = _llvm_bswap_i32(l)>>>0;
#if USE_TYPED_ARRAYS == 2
    {{{ makeStructuralReturn(['retl', 'reth']) }}};
#else
    throw 'unsupported';
#endif
  },

  llvm_ctlz_i32__deps: [function() {
    function ctlz(x) {
      for (var i = 0; i < 8; i++) {
        if (x & (1 << (7-i))) {
          return i;
        }
      }
      return 8;
    }
    return 'var ctlz_i8 = allocate([' + range(256).map(function(x) { return ctlz(x) }).join(',') + '], "i8", ALLOC_STATIC);';
  }],
  llvm_ctlz_i32__asm: true,
  llvm_ctlz_i32__sig: 'ii',
  llvm_ctlz_i32: function(x) {
    x = x|0;
    var ret = 0;
    ret = {{{ makeGetValueAsm('ctlz_i8', 'x >>> 24', 'i8') }}};
    if ((ret|0) < 8) return ret|0;
    var ret = {{{ makeGetValueAsm('ctlz_i8', '(x >> 16)&0xff', 'i8') }}};
    if ((ret|0) < 8) return (ret + 8)|0;
    var ret = {{{ makeGetValueAsm('ctlz_i8', '(x >> 8)&0xff', 'i8') }}};
    if ((ret|0) < 8) return (ret + 16)|0;
    return ({{{ makeGetValueAsm('ctlz_i8', 'x&0xff', 'i8') }}} + 24)|0;
  },

  llvm_ctlz_i64__deps: ['llvm_ctlz_i32'],
  llvm_ctlz_i64: function(l, h) {
    var ret = _llvm_ctlz_i32(h);
    if (ret == 32) ret += _llvm_ctlz_i32(l);
#if USE_TYPED_ARRAYS == 2
    {{{ makeStructuralReturn(['ret', '0']) }}};
#else
    return ret;
#endif
  },

  llvm_cttz_i32__deps: [function() {
    function cttz(x) {
      for (var i = 0; i < 8; i++) {
        if (x & (1 << i)) {
          return i;
        }
      }
      return 8;
    }
    return 'var cttz_i8 = allocate([' + range(256).map(function(x) { return cttz(x) }).join(',') + '], "i8", ALLOC_STATIC);';
  }],
  llvm_cttz_i32__asm: true,
  llvm_cttz_i32__sig: 'ii',
  llvm_cttz_i32: function(x) {
    x = x|0;
    var ret = 0;
    ret = {{{ makeGetValueAsm('cttz_i8', 'x & 0xff', 'i8') }}};
    if ((ret|0) < 8) return ret|0;
    var ret = {{{ makeGetValueAsm('cttz_i8', '(x >> 8)&0xff', 'i8') }}};
    if ((ret|0) < 8) return (ret + 8)|0;
    var ret = {{{ makeGetValueAsm('cttz_i8', '(x >> 16)&0xff', 'i8') }}};
    if ((ret|0) < 8) return (ret + 16)|0;
    return ({{{ makeGetValueAsm('cttz_i8', 'x >>> 24', 'i8') }}} + 24)|0;
  },

  llvm_cttz_i64__deps: ['llvm_cttz_i32'],
  llvm_cttz_i64: function(l, h) {
    var ret = _llvm_cttz_i32(l);
    if (ret == 32) ret += _llvm_cttz_i32(h);
#if USE_TYPED_ARRAYS == 2
    {{{ makeStructuralReturn(['ret', '0']) }}};
#else
    return ret;
#endif
  },

  llvm_ctpop_i32: function(x) {
    var ret = 0;
    while (x) {
      if (x&1) ret++;
      x >>>= 1;
    }
    return ret;
  },

  llvm_ctpop_i64__deps: ['llvm_ctpop_i32'],
  llvm_ctpop_i64: function(l, h) {
    return _llvm_ctpop_i32(l) + _llvm_ctpop_i32(h);
  },

  llvm_trap: function() {
    throw 'trap! ' + new Error().stack;
  },

  __assert_fail: function(condition, file, line) {
    ABORT = true;
    throw 'Assertion failed: ' + Pointer_stringify(condition) + ' at ' + new Error().stack;
  },

  __assert_func: function(filename, line, func, condition) {
    throw 'Assertion failed: ' + (condition ? Pointer_stringify(condition) : 'unknown condition') + ', at: ' + [filename ? Pointer_stringify(filename) : 'unknown filename', line, func ? Pointer_stringify(func) : 'unknown function'] + ' at ' + new Error().stack;
  },

  __cxa_guard_acquire: function(variable) {
    if (!{{{ makeGetValue(0, 'variable', 'i8', null, null, 1) }}}) { // ignore SAFE_HEAP stuff because llvm mixes i64 and i8 here
      {{{ makeSetValue(0, 'variable', '1', 'i8') }}};
      return 1;
    }
    return 0;
  },
  __cxa_guard_release: function() {},
  __cxa_guard_abort: function() {},

  _ZTVN10__cxxabiv119__pointer_type_infoE: [0], // is a pointer
  _ZTVN10__cxxabiv117__class_type_infoE: [1], // no inherited classes
  _ZTVN10__cxxabiv120__si_class_type_infoE: [2], // yes inherited classes

  // Exceptions
  __cxa_allocate_exception: function(size) {
    return _malloc(size);
  },
  __cxa_free_exception: function(ptr) {
    try {
      return _free(ptr);
    } catch(e) { // XXX FIXME
#if ASSERTIONS
      Module.printErr('exception during cxa_free_exception: ' + e);
#endif
    }
  },
  __cxa_throw__sig: 'viii',
  __cxa_throw__deps: ['llvm_eh_exception', '_ZSt18uncaught_exceptionv', '__cxa_find_matching_catch'],
  __cxa_throw: function(ptr, type, destructor) {
    if (!___cxa_throw.initialized) {
      try {
        {{{ makeSetValue(makeGlobalUse('__ZTVN10__cxxabiv119__pointer_type_infoE'), '0', '0', 'i32') }}}; // Workaround for libcxxabi integration bug
      } catch(e){}
      try {
        {{{ makeSetValue(makeGlobalUse('__ZTVN10__cxxabiv117__class_type_infoE'), '0', '1', 'i32') }}}; // Workaround for libcxxabi integration bug
      } catch(e){}
      try {
        {{{ makeSetValue(makeGlobalUse('__ZTVN10__cxxabiv120__si_class_type_infoE'), '0', '2', 'i32') }}}; // Workaround for libcxxabi integration bug
      } catch(e){}
      ___cxa_throw.initialized = true;
    }
#if EXCEPTION_DEBUG
    Module.printErr('Compiled code throwing an exception, ' + [ptr,type,destructor] + ', at ' + new Error().stack);
#endif
    {{{ makeSetValue('_llvm_eh_exception.buf', '0', 'ptr', 'void*') }}}
    {{{ makeSetValue('_llvm_eh_exception.buf', QUANTUM_SIZE, 'type', 'void*') }}}
    {{{ makeSetValue('_llvm_eh_exception.buf', 2 * QUANTUM_SIZE, 'destructor', 'void*') }}}
    if (!("uncaught_exception" in __ZSt18uncaught_exceptionv)) {
      __ZSt18uncaught_exceptionv.uncaught_exception = 1;
    } else {
      __ZSt18uncaught_exceptionv.uncaught_exception++;
    }
    {{{ makeThrow('ptr') }}};
  },
  __cxa_rethrow__deps: ['llvm_eh_exception', '__cxa_end_catch'],
  __cxa_rethrow: function() {
    ___cxa_end_catch.rethrown = true;
    {{{ makeThrow(makeGetValue('_llvm_eh_exception.buf', '0', 'void*')) }}};
  },
  llvm_eh_exception__postset: '_llvm_eh_exception.buf = allocate(12, "void*", ALLOC_STATIC);',
  llvm_eh_exception: function() {
    return {{{ makeGetValue('_llvm_eh_exception.buf', '0', 'void*') }}};
  },
  llvm_eh_selector__jsargs: true,
  llvm_eh_selector: function(unused_exception_value, personality/*, varargs*/) {
    var type = {{{ makeGetValue('_llvm_eh_exception.buf', QUANTUM_SIZE, 'void*') }}}
    for (var i = 2; i < arguments.length; i++) {
      if (arguments[i] ==  type) return type;
    }
    return 0;
  },
  llvm_eh_typeid_for: function(type) {
    return type;
  },
  __cxa_begin_catch__deps: ['_ZSt18uncaught_exceptionv'],
  __cxa_begin_catch: function(ptr) {
    __ZSt18uncaught_exceptionv.uncaught_exception--;
    return ptr;
  },
  __cxa_end_catch__deps: ['llvm_eh_exception', '__cxa_free_exception'],
  __cxa_end_catch: function() {
    if (___cxa_end_catch.rethrown) {
      ___cxa_end_catch.rethrown = false;
      return;
    }
    // Clear state flag.
#if ASM_JS
    asm['setThrew'](0);
#else
    __THREW__ = 0;
#endif
    // Clear type.
    {{{ makeSetValue('_llvm_eh_exception.buf', QUANTUM_SIZE, '0', 'void*') }}}
    // Call destructor if one is registered then clear it.
    var ptr = {{{ makeGetValue('_llvm_eh_exception.buf', '0', 'void*') }}};
    var destructor = {{{ makeGetValue('_llvm_eh_exception.buf', 2 * QUANTUM_SIZE, 'void*') }}};
    if (destructor) {
      Runtime.dynCall('vi', destructor, [ptr]);
      {{{ makeSetValue('_llvm_eh_exception.buf', 2 * QUANTUM_SIZE, '0', 'i32') }}}
    }
    // Free ptr if it isn't null.
    if (ptr) {
      ___cxa_free_exception(ptr);
      {{{ makeSetValue('_llvm_eh_exception.buf', '0', '0', 'void*') }}}
    }
  },
  __cxa_get_exception_ptr__deps: ['llvm_eh_exception'],
  __cxa_get_exception_ptr: function(ptr) {
    return ptr;
  },
  _ZSt18uncaught_exceptionv: function() { // std::uncaught_exception()
    return !!__ZSt18uncaught_exceptionv.uncaught_exception;
  },
  __cxa_uncaught_exception__deps: ['_Zst18uncaught_exceptionv'],
  __cxa_uncaught_exception: function() {
    return !!__ZSt18uncaught_exceptionv.uncaught_exception;
  },

  __cxa_call_unexpected: function(exception) {
    Module.printErr('Unexpected exception thrown, this is not properly supported - aborting');
    ABORT = true;
    throw exception;
  },

  _Unwind_Resume_or_Rethrow: function(ptr) {
    {{{ makeThrow('ptr') }}};
  },
  _Unwind_RaiseException: function(ptr) {
    {{{ makeThrow('ptr') }}};
  },
  _Unwind_DeleteException: function(ptr) {},

  terminate: '__cxa_call_unexpected',

  __gxx_personality_v0: function() {
  },

  __cxa_is_number_type: function(type) {
    var isNumber = false;
    try { if (type == {{{ makeGlobalUse('__ZTIi') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIj') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIl') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIm') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIx') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIy') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIf') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTId') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIe') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIc') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIa') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIh') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIs') }}}) isNumber = true } catch(e){}
    try { if (type == {{{ makeGlobalUse('__ZTIt') }}}) isNumber = true } catch(e){}
    return isNumber;
  },

  // Finds a suitable catch clause for when an exception is thrown.
  // In normal compilers, this functionality is handled by the C++
  // 'personality' routine. This is passed a fairly complex structure
  // relating to the context of the exception and makes judgements
  // about how to handle it. Some of it is about matching a suitable
  // catch clause, and some of it is about unwinding. We already handle
  // unwinding using 'if' blocks around each function, so the remaining
  // functionality boils down to picking a suitable 'catch' block.
  // We'll do that here, instead, to keep things simpler.

  __cxa_find_matching_catch__deps: ['__cxa_does_inherit', '__cxa_is_number_type', '__resumeException'],
  __cxa_find_matching_catch: function(thrown, throwntype) {
    if (thrown == -1) thrown = {{{ makeGetValue('_llvm_eh_exception.buf', '0', 'void*') }}};
    if (throwntype == -1) throwntype = {{{ makeGetValue('_llvm_eh_exception.buf', QUANTUM_SIZE, 'void*') }}};
    var typeArray = Array.prototype.slice.call(arguments, 2);

    // If throwntype is a pointer, this means a pointer has been
    // thrown. When a pointer is thrown, actually what's thrown
    // is a pointer to the pointer. We'll dereference it.
    if (throwntype != 0 && !___cxa_is_number_type(throwntype)) {
      var throwntypeInfoAddr= {{{ makeGetValue('throwntype', '0', '*') }}} - {{{ Runtime.QUANTUM_SIZE*2 }}};
      var throwntypeInfo= {{{ makeGetValue('throwntypeInfoAddr', '0', '*') }}};
      if (throwntypeInfo == 0)
        thrown = {{{ makeGetValue('thrown', '0', '*') }}};
    }
    // The different catch blocks are denoted by different types.
    // Due to inheritance, those types may not precisely match the
    // type of the thrown object. Find one which matches, and
    // return the type of the catch block which should be called.
    for (var i = 0; i < typeArray.length; i++) {
      if (___cxa_does_inherit(typeArray[i], throwntype, thrown))
        {{{ makeStructuralReturn(['thrown', 'typeArray[i]']) }}};
    }
    // Shouldn't happen unless we have bogus data in typeArray
    // or encounter a type for which emscripten doesn't have suitable
    // typeinfo defined. Best-efforts match just in case.
    {{{ makeStructuralReturn(['thrown', 'throwntype']) }}};
  },

  __resumeException__deps: [function() { Functions.libraryFunctions['__resumeException'] = 1 }], // will be called directly from compiled code
  __resumeException: function(ptr) {
#if EXCEPTION_DEBUG
    Module.print("Resuming exception");
#endif
    if ({{{ makeGetValue('_llvm_eh_exception.buf', 0, 'void*') }}} == 0) {{{ makeSetValue('_llvm_eh_exception.buf', 0, 'ptr', 'void*') }}};
    {{{ makeThrow('ptr') }}};
  },

  // Recursively walks up the base types of 'possibilityType'
  // to see if any of them match 'definiteType'.
  __cxa_does_inherit__deps: ['__cxa_is_number_type'],
  __cxa_does_inherit: function(definiteType, possibilityType, possibility) {
    if (possibility == 0) return false;
    if (possibilityType == 0 || possibilityType == definiteType)
      return true;
    var possibility_type_info;
    if (___cxa_is_number_type(possibilityType)) {
      possibility_type_info = possibilityType;
    } else {
      var possibility_type_infoAddr = {{{ makeGetValue('possibilityType', '0', '*') }}} - {{{ Runtime.QUANTUM_SIZE*2 }}};
      possibility_type_info = {{{ makeGetValue('possibility_type_infoAddr', '0', '*') }}};
    }
    switch (possibility_type_info) {
    case 0: // possibility is a pointer
      // See if definite type is a pointer
      var definite_type_infoAddr = {{{ makeGetValue('definiteType', '0', '*') }}} - {{{ Runtime.QUANTUM_SIZE*2 }}};
      var definite_type_info = {{{ makeGetValue('definite_type_infoAddr', '0', '*') }}};
      if (definite_type_info == 0) {
        // Also a pointer; compare base types of pointers
        var defPointerBaseAddr = definiteType+{{{ Runtime.QUANTUM_SIZE*2 }}};
        var defPointerBaseType = {{{ makeGetValue('defPointerBaseAddr', '0', '*') }}};
        var possPointerBaseAddr = possibilityType+{{{ Runtime.QUANTUM_SIZE*2 }}};
        var possPointerBaseType = {{{ makeGetValue('possPointerBaseAddr', '0', '*') }}};
        return ___cxa_does_inherit(defPointerBaseType, possPointerBaseType, possibility);
      } else
        return false; // one pointer and one non-pointer
    case 1: // class with no base class
      return false;
    case 2: // class with base class
      var parentTypeAddr = possibilityType + {{{ Runtime.QUANTUM_SIZE*2 }}};
      var parentType = {{{ makeGetValue('parentTypeAddr', '0', '*') }}};
      return ___cxa_does_inherit(definiteType, parentType, possibility);
    default:
      return false; // some unencountered type
    }
  },

  _ZNSt9exceptionD2Ev: function(){}, // XXX a dependency of dlmalloc, but not actually needed if libcxx is not anyhow included

  _ZNSt9type_infoD2Ev: function(){},

  // RTTI hacks for exception handling, defining type_infos for common types.
  // The values are dummies. We simply use the addresses of these statically
  // allocated variables as unique identifiers.
  _ZTIb: [0], // bool
  _ZTIi: [0], // int
  _ZTIj: [0], // unsigned int
  _ZTIl: [0], // long
  _ZTIm: [0], // unsigned long
  _ZTIx: [0], // long long
  _ZTIy: [0], // unsigned long long
  _ZTIf: [0], // float
  _ZTId: [0], // double
  _ZTIe: [0], // long double
  _ZTIc: [0], // char
  _ZTIa: [0], // signed char
  _ZTIh: [0], // unsigned char
  _ZTIs: [0], // short
  _ZTIt: [0], // unsigned short
  _ZTIv: [0], // void
  _ZTIPv: [0], // void*

  llvm_uadd_with_overflow_i8: function(x, y) {
    x = x & 0xff;
    y = y & 0xff;
    {{{ makeStructuralReturn(['(x+y) & 0xff', 'x+y > 255']) }}};
  },

  llvm_umul_with_overflow_i8: function(x, y) {
    x = x & 0xff;
    y = y & 0xff;
    {{{ makeStructuralReturn(['(x*y) & 0xff', 'x*y > 255']) }}};
  },

  llvm_uadd_with_overflow_i16: function(x, y) {
    x = x & 0xffff;
    y = y & 0xffff;
    {{{ makeStructuralReturn(['(x+y) & 0xffff', 'x+y > 65535']) }}};
  },

  llvm_umul_with_overflow_i16: function(x, y) {
    x = x & 0xffff;
    y = y & 0xffff;
    {{{ makeStructuralReturn(['(x*y) & 0xffff', 'x*y > 65535']) }}};
  },

  llvm_uadd_with_overflow_i32: function(x, y) {
    x = x>>>0;
    y = y>>>0;
    {{{ makeStructuralReturn(['(x+y)>>>0', 'x+y > 4294967295']) }}};
  },

  llvm_umul_with_overflow_i32: function(x, y) {
    x = x>>>0;
    y = y>>>0;
    {{{ makeStructuralReturn(['(x*y)>>>0', 'x*y > 4294967295']) }}};
  },

  llvm_umul_with_overflow_i64__deps: [function() { Types.preciseI64MathUsed = 1 }],
  llvm_umul_with_overflow_i64: function(xl, xh, yl, yh) {
#if ASSERTIONS
    Runtime.warnOnce('no overflow support in llvm_umul_with_overflow_i64');
#endif
    var low = ___muldi3(xl, xh, yl, yh);
    {{{ makeStructuralReturn(['low', 'tempRet0', '0']) }}};
  },

  llvm_stacksave: function() {
    var self = _llvm_stacksave;
    if (!self.LLVM_SAVEDSTACKS) {
      self.LLVM_SAVEDSTACKS = [];
    }
    self.LLVM_SAVEDSTACKS.push(Runtime.stackSave());
    return self.LLVM_SAVEDSTACKS.length-1;
  },
  llvm_stackrestore: function(p) {
    var self = _llvm_stacksave;
    var ret = self.LLVM_SAVEDSTACKS[p];
    self.LLVM_SAVEDSTACKS.splice(p, 1);
    Runtime.stackRestore(ret);
  },

  __cxa_pure_virtual: function() {
    ABORT = true;
    throw 'Pure virtual function called!';
  },

  llvm_flt_rounds: function() {
    return -1; // 'indeterminable' for FLT_ROUNDS
  },

  llvm_memory_barrier: function(){},

  llvm_atomic_load_add_i32_p0i32: function(ptr, delta) {
    var ret = {{{ makeGetValue('ptr', '0', 'i32') }}};
    {{{ makeSetValue('ptr', '0', 'ret+delta', 'i32') }}};
    return ret;
  },

  llvm_expect_i32__inline: function(val, expected) {
    return '(' + val + ')';
  },

  llvm_lifetime_start: function() {},
  llvm_lifetime_end: function() {},

  llvm_invariant_start: function() {},
  llvm_invariant_end: function() {},

  llvm_objectsize_i32: function() { return -1 }, // TODO: support this

  llvm_dbg_declare__inline: function() { throw 'llvm_debug_declare' }, // avoid warning

  // ==========================================================================
  // llvm-mono integration
  // ==========================================================================

  llvm_mono_load_i8_p0i8: function(ptr) {
    return {{{ makeGetValue('ptr', 0, 'i8') }}};
  },

  llvm_mono_store_i8_p0i8: function(value, ptr) {
    {{{ makeSetValue('ptr', 0, 'value', 'i8') }}};
  },

  llvm_mono_load_i16_p0i16: function(ptr) {
    return {{{ makeGetValue('ptr', 0, 'i16') }}};
  },

  llvm_mono_store_i16_p0i16: function(value, ptr) {
    {{{ makeSetValue('ptr', 0, 'value', 'i16') }}};
  },

  llvm_mono_load_i32_p0i32: function(ptr) {
    return {{{ makeGetValue('ptr', 0, 'i32') }}};
  },

  llvm_mono_store_i32_p0i32: function(value, ptr) {
    {{{ makeSetValue('ptr', 0, 'value', 'i32') }}};
  },

  // ==========================================================================
  // math.h
  // ==========================================================================

  cos: 'Math.cos',
  cosf: 'Math.cos',
  sin: 'Math.sin',
  sinf: 'Math.sin',
  tan: 'Math.tan',
  tanf: 'Math.tan',
  acos: 'Math.acos',
  acosf: 'Math.acos',
  asin: 'Math.asin',
  asinf: 'Math.asin',
  atan: 'Math.atan',
  atanf: 'Math.atan',
  atan2: 'Math.atan2',
  atan2f: 'Math.atan2',
  exp: 'Math.exp',
  expf: 'Math.exp',

  // The erf and erfc functions are inspired from
  // http://www.digitalmars.com/archives/cplusplus/3634.html
  // and mruby source code at
  // https://github.com/mruby/mruby/blob/master/src/math.c
  erfc: function(x) {
    var MATH_TOLERANCE = 1E-12;
    var ONE_SQRTPI = 0.564189583547756287;
    var a = 1;
    var b = x;
    var c = x;
    var d = x * x + 0.5;
    var n = 1.0;
    var q2 = b / d;
    var q1, t;

    if (Math.abs(x) < 2.2) {
      return 1.0 - _erf(x);
    }
    if (x < 0) {
      return 2.0 - _erfc(-x);
    }
    do {
      t = a * n + b * x;
      a = b;
      b = t;
      t = c * n + d * x;
      c = d;
      d = t;
      n += 0.5;
      q1 = q2;
      q2 = b / d;
    } while (Math.abs(q1 - q2) / q2 > MATH_TOLERANCE);
    return (ONE_SQRTPI * Math.exp(- x * x) * q2);
  },
  erfcf: 'erfcf',
  erf__deps: ['erfc'],
  erf: function(x) {
    var MATH_TOLERANCE = 1E-12;
    var TWO_SQRTPI = 1.128379167095512574;
    var sum = x;
    var term = x;
    var xsqr = x*x;
    var j = 1;

    if (Math.abs(x) > 2.2) {
      return 1.0 - _erfc(x);
    }
    do {
      term *= xsqr / j;
      sum -= term / (2 * j + 1);
      ++j;
      term *= xsqr / j;
      sum += term / (2 * j + 1);
      ++j;
    } while (Math.abs(term / sum) > MATH_TOLERANCE);
    return (TWO_SQRTPI * sum);
  },
  erff: 'erf',
  log: 'Math.log',
  logf: 'Math.log',
  sqrt: 'Math.sqrt',
  sqrtf: 'Math.sqrt',
  fabs: 'Math.abs',
  fabsf: 'Math.abs',
  ceil: 'Math.ceil',
  ceilf: 'Math.ceil',
  floor: 'Math.floor',
  floorf: 'Math.floor',
  pow: 'Math.pow',
  powf: 'Math.pow',
  llvm_sqrt_f32: 'Math.sqrt',
  llvm_sqrt_f64: 'Math.sqrt',
  llvm_pow_f32: 'Math.pow',
  llvm_pow_f64: 'Math.pow',
  llvm_log_f32: 'Math.log',
  llvm_log_f64: 'Math.log',
  llvm_exp_f32: 'Math.exp',
  llvm_exp_f64: 'Math.exp',
  ldexp: function(x, exp_) {
    return x * Math.pow(2, exp_);
  },
  ldexpf: 'ldexp',
  scalb: 'ldexp',
  scalbn: 'ldexp',
  scalbnf: 'ldexp',
  scalbln: 'ldexp',
  scalblnf: 'ldexp',
  cbrt: function(x) {
    return Math.pow(x, 1/3);
  },
  cbrtf: 'cbrt',
  cbrtl: 'cbrt',

  modf: function(x, intpart) {
    {{{ makeSetValue('intpart', 0, 'Math.floor(x)', 'double') }}}
    return x - {{{ makeGetValue('intpart', 0, 'double') }}};
  },
  modff: function(x, intpart) {
    {{{ makeSetValue('intpart', 0, 'Math.floor(x)', 'float') }}}
    return x - {{{ makeGetValue('intpart', 0, 'float') }}};
  },
  frexp: function(x, exp_addr) {
    var sig = 0, exp_ = 0;
    if (x !== 0) {
      var sign = 1;
      if (x < 0) {
        x = -x;
        sign = -1;
      }
      var raw_exp = Math.log(x)/Math.log(2);
      exp_ = Math.ceil(raw_exp);
      if (exp_ === raw_exp) exp_ += 1;
      sig = sign*x/Math.pow(2, exp_);
    }
    {{{ makeSetValue('exp_addr', 0, 'exp_', 'i32') }}}
    return sig;
  },
  frexpf: 'frexp',
  finite: function(x) {
    return isFinite(x);
  },
  __finite: 'finite',
  isinf: function(x) {
    return !isNaN(x) && !isFinite(x);
  },
  __isinf: 'isinf',
  isnan: function(x) {
    return isNaN(x);
  },
  __isnan: 'isnan',

  _reallyNegative: function(x) {
    return x < 0 || (x === 0 && (1/x) === -Infinity);
  },

  copysign__deps: ['_reallyNegative'],
  copysign: function(a, b) {
    return __reallyNegative(a) === __reallyNegative(b) ? a : -a;
  },
  copysignf: 'copysign',
  __signbit__deps: ['copysign'],
  __signbit: function(x) {
    // We implement using copysign so that we get support
    // for negative zero (once copysign supports that).
    return _copysign(1.0, x) < 0;
  },
  __signbitf: '__signbit',
  __signbitd: '__signbit',
  hypot: function(a, b) {
     return Math.sqrt(a*a + b*b);
  },
  hypotf: 'hypot',
  sinh: function(x) {
    var p = Math.pow(Math.E, x);
    return (p - (1 / p)) / 2;
  },
  sinhf: 'sinh',
  cosh: function(x) {
    var p = Math.pow(Math.E, x);
    return (p + (1 / p)) / 2;
  },
  coshf: 'cosh',
  tanh__deps: ['sinh', 'cosh'],
  tanh: function(x) {
    return _sinh(x) / _cosh(x);
  },
  tanhf: 'tanh',
  asinh: function(x) {
    return Math.log(x + Math.sqrt(x * x + 1));
  },
  asinhf: 'asinh',
  acosh: function(x) {
    return Math.log(x * 1 + Math.sqrt(x * x - 1));
  },
  acoshf: 'acosh',
  atanh: function(x) {
    return Math.log((1 + x) / (1 - x)) / 2;
  },
  atanhf: 'atanh',
  exp2: function(x) {
    return Math.pow(2, x);
  },
  exp2f: 'exp2',
  expm1: function(x) {
    return Math.exp(x) - 1;
  },
  expm1f: 'expm1',
  round: function(x) {
    return (x < 0) ? -Math.round(-x) : Math.round(x);
  },
  roundf: 'round',
  lround: 'round',
  lroundf: 'round',
  llround: 'round',
  llroundf: 'round',
  rint: function(x) {
    if (Math.abs(x % 1) !== 0.5) return Math.round(x);
    return x + x % 2 + ((x < 0) ? 1 : -1);
  },
  rintf: 'rint',
  lrint: 'rint',
  lrintf: 'rint',
#if USE_TYPED_ARRAYS == 2
  llrint: function(x) {
    x = (x < 0) ? -Math.round(-x) : Math.round(x);
    {{{ makeStructuralReturn(splitI64('x')) }}};
  },
#else
  llrint: 'rint',
#endif
  llrintf: 'llrint',
  nearbyint: 'rint',
  nearbyintf: 'rint',
  trunc: function(x) {
    return (x < 0) ? Math.ceil(x) : Math.floor(x);
  },
  truncf: 'trunc',
  fdim: function(x, y) {
    return (x > y) ? x - y : 0;
  },
  fdimf: 'fdim',
  fmax: function(x, y) {
    return isNaN(x) ? y : isNaN(y) ? x : Math.max(x, y);
  },
  fmaxf: 'fmax',
  fmin: function(x, y) {
    return isNaN(x) ? y : isNaN(y) ? x : Math.min(x, y);
  },
  fminf: 'fmin',
  fma: function(x, y, z) {
    return x * y + z;
  },
  fmaf: 'fma',
  fmod: function(x, y) {
    return x % y;
  },
  fmodf: 'fmod',
  remainder: 'fmod',
  remainderf: 'fmod',
  log10: function(x) {
    return Math.log(x) / Math.LN10;
  },
  log10f: 'log10',
  log1p: function(x) {
    return Math.log(1 + x);
  },
  log1pf: 'log1p',
  log2: function(x) {
    return Math.log(x) / Math.LN2;
  },
  log2f: 'log2',
  nan: function(x) {
    return NaN;
  },
  nanf: 'nan',

  sincos: function(x, sine, cosine) {
    var sineVal = Math.sin(x),
        cosineVal = Math.cos(x);
    {{{ makeSetValue('sine', '0', 'sineVal', 'double') }}};
    {{{ makeSetValue('cosine', '0', 'cosineVal', 'double') }}};
  },

  sincosf: function(x, sine, cosine) {
    var sineVal = Math.sin(x),
        cosineVal = Math.cos(x);
    {{{ makeSetValue('sine', '0', 'sineVal', 'float') }}};
    {{{ makeSetValue('cosine', '0', 'cosineVal', 'float') }}};
  },

  __div_t_struct_layout: Runtime.generateStructInfo([
                            ['i32', 'quot'],
                            ['i32', 'rem'],
                          ]),
  div__deps: ['__div_t_struct_layout'],
  div: function(divt, numer, denom) {
    var quot = Math.floor(numer / denom);
    var rem = numer - quot * denom;
    var offset = ___div_t_struct_layout.rem;
    {{{ makeSetValue('divt', '0', 'quot', 'i32') }}};
    {{{ makeSetValue('divt', 'offset', 'rem', 'i32') }}};
    return divt;
  },

  __fpclassifyf: function(x) {
    if (isNaN(x)) return {{{ cDefine('FP_NAN') }}};
    if (!isFinite(x)) return {{{ cDefine('FP_INFINITE') }}};
    if (x == 0) return {{{ cDefine('FP_ZERO') }}};
    // FP_SUBNORMAL..?
    return {{{ cDefine('FP_NORMAL') }}};
  },
  __fpclassifyd: '__fpclassifyf',

  // ==========================================================================
  // sys/utsname.h
  // ==========================================================================

  __utsname_struct_layout: Runtime.generateStructInfo([
      ['b32', 'sysname'],
      ['b32', 'nodename'],
      ['b32', 'release'],
      ['b32', 'version'],
      ['b32', 'machine']]),
  __sys_uname__deps: ['__utsname_struct_layout'],
  __sys_uname: function(name) {
    // int uname(struct utsname *name);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/uname.html
    function copyString(element, value) {
      var offset = ___utsname_struct_layout[element];
      for (var i = 0; i < value.length; i++) {
        {{{ makeSetValue('name', 'offset + i', 'value.charCodeAt(i)', 'i8') }}}
      }
      {{{ makeSetValue('name', 'offset + i', '0', 'i8') }}}
    }
    if (name === 0) {
      return -1;
    } else {
      copyString('sysname', 'Emscripten');
      copyString('nodename', 'emscripten');
      copyString('release', '1.0');
      copyString('version', '#1');
      copyString('machine', 'x86-JS');
      return 0;
    }
  },

  // ==========================================================================
  // dlfcn.h - Dynamic library loading
  //
  // Some limitations:
  //
  //  * Minification on each file separately may not work, as they will
  //    have different shortened names. You can in theory combine them, then
  //    minify, then split... perhaps.
  //
  //  * LLVM optimizations may fail. If the child wants to access a function
  //    in the parent, LLVM opts may remove it from the parent when it is
  //    being compiled. Not sure how to tell LLVM to not do so.
  // ==========================================================================

  // Data for dlfcn.h.
  $DLFCN_DATA: {
    error: null,
    errorMsg: null,
    loadedLibs: {}, // handle -> [refcount, name, lib_object]
    loadedLibNames: {}, // name -> handle
  },
  // void* dlopen(const char* filename, int flag);
  dlopen__deps: ['$DLFCN_DATA', '$FS', '$ENV'],
  dlopen: function(filename, flag) {
    // void *dlopen(const char *file, int mode);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/dlopen.html
    filename = filename === 0 ? '__self__' : (ENV['LD_LIBRARY_PATH'] || '/') + Pointer_stringify(filename);

    if (DLFCN_DATA.loadedLibNames[filename]) {
      // Already loaded; increment ref count and return.
      var handle = DLFCN_DATA.loadedLibNames[filename];
      DLFCN_DATA.loadedLibs[handle].refcount++;
      return handle;
    }

    if (filename === '__self__') {
      var handle = -1;
      var lib_module = Module;
      var cached_functions = SYMBOL_TABLE;
    } else {
      var target = FS.findObject(filename);
      if (!target || target.isFolder || target.isDevice) {
        DLFCN_DATA.errorMsg = 'Could not find dynamic lib: ' + filename;
        return 0;
      } else {
        FS.forceLoadFile(target);
        var lib_data = intArrayToString(target.contents);
      }

      try {
        var lib_module = eval(lib_data)({{{ Functions.getTable('x') }}}.length);
      } catch (e) {
#if ASSERTIONS
        Module.printErr('Error in loading dynamic library: ' + e);
#endif
        DLFCN_DATA.errorMsg = 'Could not evaluate dynamic lib: ' + filename;
        return 0;
      }

      // Not all browsers support Object.keys().
      var handle = 1;
      for (var key in DLFCN_DATA.loadedLibs) {
        if (DLFCN_DATA.loadedLibs.hasOwnProperty(key)) handle++;
      }

      // We don't care about RTLD_NOW and RTLD_LAZY.
      if (flag & 256) { // RTLD_GLOBAL
        for (var ident in lib_module) {
          if (lib_module.hasOwnProperty(ident)) {
            Module[ident] = lib_module[ident];
          }
        }
      }

      var cached_functions = {};
    }
    DLFCN_DATA.loadedLibs[handle] = {
      refcount: 1,
      name: filename,
      module: lib_module,
      cached_functions: cached_functions
    };
    DLFCN_DATA.loadedLibNames[filename] = handle;

    return handle;
  },
  // int dlclose(void* handle);
  dlclose__deps: ['$DLFCN_DATA'],
  dlclose: function(handle) {
    // int dlclose(void *handle);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/dlclose.html
    if (!DLFCN_DATA.loadedLibs[handle]) {
      DLFCN_DATA.errorMsg = 'Tried to dlclose() unopened handle: ' + handle;
      return 1;
    } else {
      var lib_record = DLFCN_DATA.loadedLibs[handle];
      if (--lib_record.refcount == 0) {
        delete DLFCN_DATA.loadedLibNames[lib_record.name];
        delete DLFCN_DATA.loadedLibs[handle];
      }
      return 0;
    }
  },
  // void* dlsym(void* handle, const char* symbol);
  dlsym__deps: ['$DLFCN_DATA'],
  dlsym: function(handle, symbol) {
    // void *dlsym(void *restrict handle, const char *restrict name);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/dlsym.html
    symbol = '_' + Pointer_stringify(symbol);

    if (!DLFCN_DATA.loadedLibs[handle]) {
      DLFCN_DATA.errorMsg = 'Tried to dlsym() from an unopened handle: ' + handle;
      return 0;
    } else {
      var lib = DLFCN_DATA.loadedLibs[handle];
      // self-dlopen means that lib.module is not a superset of
      // cached_functions, so check the latter first
      if (lib.cached_functions.hasOwnProperty(symbol)) {
        return lib.cached_functions[symbol];
      } else {
        if (!lib.module.hasOwnProperty(symbol)) {
          DLFCN_DATA.errorMsg = ('Tried to lookup unknown symbol "' + symbol +
                                 '" in dynamic lib: ' + lib.name);
          return 0;
        } else {
          var result = lib.module[symbol];
          if (typeof result == 'function') {
            {{{ Functions.getTable('x') }}}.push(result);
            {{{ Functions.getTable('x') }}}.push(0);
            result = {{{ Functions.getTable('x') }}}.length - 2;
            lib.cached_functions = result;
          }
          return result;
        }
      }
    }
  },
  // char* dlerror(void);
  dlerror__deps: ['$DLFCN_DATA'],
  dlerror: function() {
    // char *dlerror(void);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/dlerror.html
    if (DLFCN_DATA.errorMsg === null) {
      return 0;
    } else {
      if (DLFCN_DATA.error) _free(DLFCN_DATA.error);
      var msgArr = intArrayFromString(DLFCN_DATA.errorMsg);
      DLFCN_DATA.error = allocate(msgArr, 'i8', ALLOC_NORMAL);
      DLFCN_DATA.errorMsg = null;
      return DLFCN_DATA.error;
    }
  },

  // ==========================================================================
  // sys/time.h
  // ==========================================================================

  __sys_clock_gettime__deps: ['__timespec_struct_layout'],
  __sys_clock_gettime: function(clk_id, tp) {
    // int clock_gettime(clockid_t clk_id, struct timespec *tp);
    // http://man7.org/linux/man-pages/man2/clock_gettime.2.html
    var now = Date.now();
    {{{ makeSetValue('tp', '___timespec_struct_layout.tv_sec', '(now / 1000) | 0', 'i32') }}}; // seconds
    {{{ makeSetValue('tp', '___timespec_struct_layout.tv_nsec', '(now % 1000) * 1e6', 'i32') }}}; // nanoseconds
    return 0;
  },
  __sys_clock_settime: function(clk_id, tp) {
    // int clock_settime(clockid_t clk_id, const struct timespec *tp);
    // http://man7.org/linux/man-pages/man2/clock_gettime.2.html
    return 0;
  },
  __sys_clock_getres__deps: ['__timespec_struct_layout'],
  __sys_clock_getres: function(clk_id, res) {
    // int clock_getres(clockid_t clk_id, struct timespec *res);
    // http://man7.org/linux/man-pages/man2/clock_gettime.2.html
    {{{ makeSetValue('res', '___timespec_struct_layout.tv_sec', '0', 'i32') }}}
    {{{ makeSetValue('res', '___timespec_struct_layout.tv_nsec', '1e6', 'i32') }}}
    return 0;
  },

  // ==========================================================================
  // sys/times.h
  // ==========================================================================

  __tms_struct_layout: Runtime.generateStructInfo([
    ['i32', 'tms_utime'],
    ['i32', 'tms_stime'],
    ['i32', 'tms_cutime'],
    ['i32', 'tms_cstime']]),
  __sys_times__deps: ['__tms_struct_layout', 'memset'],
  __sys_times: function(buffer) {
    // clock_t times(struct tms *buffer);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/times.html
    // NOTE: This is fake, since we can't calculate real CPU time usage in JS.
    if (buffer !== 0) {
      _memset(buffer, 0, ___tms_struct_layout.__size__);
    }
    return 0;
  },

  // ==========================================================================
  // sys/types.h
  // ==========================================================================
  // http://www.kernel.org/doc/man-pages/online/pages/man3/minor.3.html
  makedev: function(maj, min) {
    return ((maj) << 8 | (min));
  },
  gnu_dev_makedev: 'makedev',
  major: function(dev) {
    return ((dev) >> 8);
  },
  gnu_dev_major: 'major',
  minor: function(dev) {
    return ((dev) & 0xff);
  },
  gnu_dev_minor: 'minor',

  // ==========================================================================
  // setjmp.h
  //
  // Basic support for setjmp/longjmp: enough to run the wikipedia example and
  // hopefully handle most normal behavior. We do not support cases where
  // longjmp behavior is undefined (for example, if the setjmp function returns
  // before longjmp is called).
  //
  // Note that we need to emulate functions that use setjmp, and also to create
  // a new label we can return to. Emulation make such functions slower, this
  // can be alleviated by making a new function containing just the setjmp
  // related functionality so the slowdown is more limited - you may need
  // to prevent inlining to keep this isolated, try __attribute__((noinline))
  // ==========================================================================

  saveSetjmp__asm: true,
  saveSetjmp__sig: 'iii',
  saveSetjmp__deps: ['putchar'],
  saveSetjmp: function(env, label, table) {
    // Not particularly fast: slow table lookup of setjmpId to label. But setjmp
    // prevents relooping anyhow, so slowness is to be expected. And typical case
    // is 1 setjmp per invocation, or less.
    env = env|0;
    label = label|0;
    table = table|0;
    var i = 0;
#if ASSERTIONS
    if ((label|0) == 0) abort(121);
#endif
    setjmpId = (setjmpId+1)|0;
    {{{ makeSetValueAsm('env', '0', 'setjmpId', 'i32') }}};
    while ((i|0) < {{{ 2*MAX_SETJMPS }}}) {
      if ({{{ makeGetValueAsm('table', '(i<<2)', 'i32') }}} == 0) {
        {{{ makeSetValueAsm('table', '(i<<2)', 'setjmpId', 'i32') }}};
        {{{ makeSetValueAsm('table', '(i<<2)+4', 'label', 'i32') }}};
        // prepare next slot
        {{{ makeSetValueAsm('table', '(i<<2)+8', '0', 'i32') }}};
        return 0;
      }
      i = (i+2)|0;
    }
    {{{ makePrintChars('too many setjmps in a function call, build with a higher value for MAX_SETJMPS') }}};
    abort(0);
    return 0;
  },

  testSetjmp__asm: true,
  testSetjmp__sig: 'iii',
  testSetjmp: function(id, table) {
    id = id|0;
    table = table|0;
    var i = 0, curr = 0;
    while ((i|0) < {{{ MAX_SETJMPS }}}) {
      curr = {{{ makeGetValueAsm('table', '(i<<2)', 'i32') }}};
      if ((curr|0) == 0) break;
      if ((curr|0) == (id|0)) {
        return {{{ makeGetValueAsm('table', '(i<<2)+4', 'i32') }}};
      }
      i = (i+2)|0;
    }
    return 0;
  },

#if ASM_JS
  setjmp__deps: ['saveSetjmp', 'testSetjmp'],
#endif
  setjmp__inline: function(env) {
    // Save the label
#if ASM_JS
    return '_saveSetjmp(' + env + ', label, setjmpTable)|0';
#else
    return '(tempInt = setjmpId++, mySetjmpIds[tempInt] = 1, setjmpLabels[tempInt] = label,' + makeSetValue(env, '0', 'tempInt', 'i32', undefined, undefined, undefined, undefined,  ',') + ', 0)';
#endif
  },

#if ASM_JS
  longjmp__deps: ['saveSetjmp', 'testSetjmp'],
#endif
  longjmp: function(env, value) {
#if ASM_JS
    asm['setThrew'](env, value || 1);
    throw 'longjmp';
#else
    throw { longjmp: true, id: {{{ makeGetValue('env', '0', 'i32') }}}, value: value || 1 };
#endif
  },

  // ==========================================================================
  // errno.h
  // ==========================================================================

  $ERRNO_CODES: {
    EPERM: {{{ cDefine('EPERM') }}},
    ENOENT: {{{ cDefine('ENOENT') }}},
    ESRCH: {{{ cDefine('ESRCH') }}},
    EINTR: {{{ cDefine('EINTR') }}},
    EIO: {{{ cDefine('EIO') }}},
    ENXIO: {{{ cDefine('ENXIO') }}},
    E2BIG: {{{ cDefine('E2BIG') }}},
    ENOEXEC: {{{ cDefine('ENOEXEC') }}},
    EBADF: {{{ cDefine('EBADF') }}},
    ECHILD: {{{ cDefine('ECHILD') }}},
    EAGAIN: {{{ cDefine('EAGAIN') }}},
    EWOULDBLOCK: {{{ cDefine('EWOULDBLOCK') }}},
    ENOMEM: {{{ cDefine('ENOMEM') }}},
    EACCES: {{{ cDefine('EACCES') }}},
    EFAULT: {{{ cDefine('EFAULT') }}},
    ENOTBLK: {{{ cDefine('ENOTBLK') }}},
    EBUSY: {{{ cDefine('EBUSY') }}},
    EEXIST: {{{ cDefine('EEXIST') }}},
    EXDEV: {{{ cDefine('EXDEV') }}},
    ENODEV: {{{ cDefine('ENODEV') }}},
    ENOTDIR: {{{ cDefine('ENOTDIR') }}},
    EISDIR: {{{ cDefine('EISDIR') }}},
    EINVAL: {{{ cDefine('EINVAL') }}},
    ENFILE: {{{ cDefine('ENFILE') }}},
    EMFILE: {{{ cDefine('EMFILE') }}},
    ENOTTY: {{{ cDefine('ENOTTY') }}},
    ETXTBSY: {{{ cDefine('ETXTBSY') }}},
    EFBIG: {{{ cDefine('EFBIG') }}},
    ENOSPC: {{{ cDefine('ENOSPC') }}},
    ESPIPE: {{{ cDefine('ESPIPE') }}},
    EROFS: {{{ cDefine('EROFS') }}},
    EMLINK: {{{ cDefine('EMLINK') }}},
    EPIPE: {{{ cDefine('EPIPE') }}},
    EDOM: {{{ cDefine('EDOM') }}},
    ERANGE: {{{ cDefine('ERANGE') }}},
    ENOMSG: {{{ cDefine('ENOMSG') }}},
    EIDRM: {{{ cDefine('EIDRM') }}},
    ECHRNG: {{{ cDefine('ECHRNG') }}},
    EL2NSYNC: {{{ cDefine('EL2NSYNC') }}},
    EL3HLT: {{{ cDefine('EL3HLT') }}},
    EL3RST: {{{ cDefine('EL3RST') }}},
    ELNRNG: {{{ cDefine('ELNRNG') }}},
    EUNATCH: {{{ cDefine('EUNATCH') }}},
    ENOCSI: {{{ cDefine('ENOCSI') }}},
    EL2HLT: {{{ cDefine('EL2HLT') }}},
    EDEADLK: {{{ cDefine('EDEADLK') }}},
    ENOLCK: {{{ cDefine('ENOLCK') }}},
    EBADE: {{{ cDefine('EBADE') }}},
    EBADR: {{{ cDefine('EBADR') }}},
    EXFULL: {{{ cDefine('EXFULL') }}},
    ENOANO: {{{ cDefine('ENOANO') }}},
    EBADRQC: {{{ cDefine('EBADRQC') }}},
    EBADSLT: {{{ cDefine('EBADSLT') }}},
    EDEADLOCK: {{{ cDefine('EDEADLOCK') }}},
    EBFONT: {{{ cDefine('EBFONT') }}},
    ENOSTR: {{{ cDefine('ENOSTR') }}},
    ENODATA: {{{ cDefine('ENODATA') }}},
    ETIME: {{{ cDefine('ETIME') }}},
    ENOSR: {{{ cDefine('ENOSR') }}},
    ENONET: {{{ cDefine('ENONET') }}},
    ENOPKG: {{{ cDefine('ENOPKG') }}},
    EREMOTE: {{{ cDefine('EREMOTE') }}},
    ENOLINK: {{{ cDefine('ENOLINK') }}},
    EADV: {{{ cDefine('EADV') }}},
    ESRMNT: {{{ cDefine('ESRMNT') }}},
    ECOMM: {{{ cDefine('ECOMM') }}},
    EPROTO: {{{ cDefine('EPROTO') }}},
    EMULTIHOP: {{{ cDefine('EMULTIHOP') }}},
    EDOTDOT: {{{ cDefine('EDOTDOT') }}},
    EBADMSG: {{{ cDefine('EBADMSG') }}},
    ENOTUNIQ: {{{ cDefine('ENOTUNIQ') }}},
    EBADFD: {{{ cDefine('EBADFD') }}},
    EREMCHG: {{{ cDefine('EREMCHG') }}},
    ELIBACC: {{{ cDefine('ELIBACC') }}},
    ELIBBAD: {{{ cDefine('ELIBBAD') }}},
    ELIBSCN: {{{ cDefine('ELIBSCN') }}},
    ELIBMAX: {{{ cDefine('ELIBMAX') }}},
    ELIBEXEC: {{{ cDefine('ELIBEXEC') }}},
    ENOSYS: {{{ cDefine('ENOSYS') }}},
    ENOTEMPTY: {{{ cDefine('ENOTEMPTY') }}},
    ENAMETOOLONG: {{{ cDefine('ENAMETOOLONG') }}},
    ELOOP: {{{ cDefine('ELOOP') }}},
    EOPNOTSUPP: {{{ cDefine('EOPNOTSUPP') }}},
    EPFNOSUPPORT: {{{ cDefine('EPFNOSUPPORT') }}},
    ECONNRESET: {{{ cDefine('ECONNRESET') }}},
    ENOBUFS: {{{ cDefine('ENOBUFS') }}},
    EAFNOSUPPORT: {{{ cDefine('EAFNOSUPPORT') }}},
    EPROTOTYPE: {{{ cDefine('EPROTOTYPE') }}},
    ENOTSOCK: {{{ cDefine('ENOTSOCK') }}},
    ENOPROTOOPT: {{{ cDefine('ENOPROTOOPT') }}},
    ESHUTDOWN: {{{ cDefine('ESHUTDOWN') }}},
    ECONNREFUSED: {{{ cDefine('ECONNREFUSED') }}},
    EADDRINUSE: {{{ cDefine('EADDRINUSE') }}},
    ECONNABORTED: {{{ cDefine('ECONNABORTED') }}},
    ENETUNREACH: {{{ cDefine('ENETUNREACH') }}},
    ENETDOWN: {{{ cDefine('ENETDOWN') }}},
    ETIMEDOUT: {{{ cDefine('ETIMEDOUT') }}},
    EHOSTDOWN: {{{ cDefine('EHOSTDOWN') }}},
    EHOSTUNREACH: {{{ cDefine('EHOSTUNREACH') }}},
    EINPROGRESS: {{{ cDefine('EINPROGRESS') }}},
    EALREADY: {{{ cDefine('EALREADY') }}},
    EDESTADDRREQ: {{{ cDefine('EDESTADDRREQ') }}},
    EMSGSIZE: {{{ cDefine('EMSGSIZE') }}},
    EPROTONOSUPPORT: {{{ cDefine('EPROTONOSUPPORT') }}},
    ESOCKTNOSUPPORT: {{{ cDefine('ESOCKTNOSUPPORT') }}},
    EADDRNOTAVAIL: {{{ cDefine('EADDRNOTAVAIL') }}},
    ENETRESET: {{{ cDefine('ENETRESET') }}},
    EISCONN: {{{ cDefine('EISCONN') }}},
    ENOTCONN: {{{ cDefine('ENOTCONN') }}},
    ETOOMANYREFS: {{{ cDefine('ETOOMANYREFS') }}},
    EUSERS: {{{ cDefine('EUSERS') }}},
    EDQUOT: {{{ cDefine('EDQUOT') }}},
    ESTALE: {{{ cDefine('ESTALE') }}},
    ENOTSUP: {{{ cDefine('ENOTSUP') }}},
    ENOMEDIUM: {{{ cDefine('ENOMEDIUM') }}},
    EILSEQ: {{{ cDefine('EILSEQ') }}},
    EOVERFLOW: {{{ cDefine('EOVERFLOW') }}},
    ECANCELED: {{{ cDefine('ECANCELED') }}},
    ENOTRECOVERABLE: {{{ cDefine('ENOTRECOVERABLE') }}},
    EOWNERDEAD: {{{ cDefine('EOWNERDEAD') }}},
    ESTRPIPE: {{{ cDefine('ESTRPIPE') }}},
  },
  $ERRNO_MESSAGES: {
    0: 'Success',
    {{{ cDefine('EPERM') }}}: 'Not super-user',
    {{{ cDefine('ENOENT') }}}: 'No such file or directory',
    {{{ cDefine('ESRCH') }}}: 'No such process',
    {{{ cDefine('EINTR') }}}: 'Interrupted system call',
    {{{ cDefine('EIO') }}}: 'I/O error',
    {{{ cDefine('ENXIO') }}}: 'No such device or address',
    {{{ cDefine('E2BIG') }}}: 'Arg list too long',
    {{{ cDefine('ENOEXEC') }}}: 'Exec format error',
    {{{ cDefine('EBADF') }}}: 'Bad file number',
    {{{ cDefine('ECHILD') }}}: 'No children',
    {{{ cDefine('EWOULDBLOCK') }}}: 'No more processes',
    {{{ cDefine('ENOMEM') }}}: 'Not enough core',
    {{{ cDefine('EACCES') }}}: 'Permission denied',
    {{{ cDefine('EFAULT') }}}: 'Bad address',
    {{{ cDefine('ENOTBLK') }}}: 'Block device required',
    {{{ cDefine('EBUSY') }}}: 'Mount device busy',
    {{{ cDefine('EEXIST') }}}: 'File exists',
    {{{ cDefine('EXDEV') }}}: 'Cross-device link',
    {{{ cDefine('ENODEV') }}}: 'No such device',
    {{{ cDefine('ENOTDIR') }}}: 'Not a directory',
    {{{ cDefine('EISDIR') }}}: 'Is a directory',
    {{{ cDefine('EINVAL') }}}: 'Invalid argument',
    {{{ cDefine('ENFILE') }}}: 'Too many open files in system',
    {{{ cDefine('EMFILE') }}}: 'Too many open files',
    {{{ cDefine('ENOTTY') }}}: 'Not a typewriter',
    {{{ cDefine('ETXTBSY') }}}: 'Text file busy',
    {{{ cDefine('EFBIG') }}}: 'File too large',
    {{{ cDefine('ENOSPC') }}}: 'No space left on device',
    {{{ cDefine('ESPIPE') }}}: 'Illegal seek',
    {{{ cDefine('EROFS') }}}: 'Read only file system',
    {{{ cDefine('EMLINK') }}}: 'Too many links',
    {{{ cDefine('EPIPE') }}}: 'Broken pipe',
    {{{ cDefine('EDOM') }}}: 'Math arg out of domain of func',
    {{{ cDefine('ERANGE') }}}: 'Math result not representable',
    {{{ cDefine('ENOMSG') }}}: 'No message of desired type',
    {{{ cDefine('EIDRM') }}}: 'Identifier removed',
    {{{ cDefine('ECHRNG') }}}: 'Channel number out of range',
    {{{ cDefine('EL2NSYNC') }}}: 'Level 2 not synchronized',
    {{{ cDefine('EL3HLT') }}}: 'Level 3 halted',
    {{{ cDefine('EL3RST') }}}: 'Level 3 reset',
    {{{ cDefine('ELNRNG') }}}: 'Link number out of range',
    {{{ cDefine('EUNATCH') }}}: 'Protocol driver not attached',
    {{{ cDefine('ENOCSI') }}}: 'No CSI structure available',
    {{{ cDefine('EL2HLT') }}}: 'Level 2 halted',
    {{{ cDefine('EDEADLK') }}}: 'Deadlock condition',
    {{{ cDefine('ENOLCK') }}}: 'No record locks available',
    {{{ cDefine('EBADE') }}}: 'Invalid exchange',
    {{{ cDefine('EBADR') }}}: 'Invalid request descriptor',
    {{{ cDefine('EXFULL') }}}: 'Exchange full',
    {{{ cDefine('ENOANO') }}}: 'No anode',
    {{{ cDefine('EBADRQC') }}}: 'Invalid request code',
    {{{ cDefine('EBADSLT') }}}: 'Invalid slot',
    {{{ cDefine('EDEADLOCK') }}}: 'File locking deadlock error',
    {{{ cDefine('EBFONT') }}}: 'Bad font file fmt',
    {{{ cDefine('ENOSTR') }}}: 'Device not a stream',
    {{{ cDefine('ENODATA') }}}: 'No data (for no delay io)',
    {{{ cDefine('ETIME') }}}: 'Timer expired',
    {{{ cDefine('ENOSR') }}}: 'Out of streams resources',
    {{{ cDefine('ENONET') }}}: 'Machine is not on the network',
    {{{ cDefine('ENOPKG') }}}: 'Package not installed',
    {{{ cDefine('EREMOTE') }}}: 'The object is remote',
    {{{ cDefine('ENOLINK') }}}: 'The link has been severed',
    {{{ cDefine('EADV') }}}: 'Advertise error',
    {{{ cDefine('ESRMNT') }}}: 'Srmount error',
    {{{ cDefine('ECOMM') }}}: 'Communication error on send',
    {{{ cDefine('EPROTO') }}}: 'Protocol error',
    {{{ cDefine('EMULTIHOP') }}}: 'Multihop attempted',
    {{{ cDefine('EDOTDOT') }}}: 'Cross mount point (not really error)',
    {{{ cDefine('EBADMSG') }}}: 'Trying to read unreadable message',
    {{{ cDefine('ENOTUNIQ') }}}: 'Given log. name not unique',
    {{{ cDefine('EBADFD') }}}: 'f.d. invalid for this operation',
    {{{ cDefine('EREMCHG') }}}: 'Remote address changed',
    {{{ cDefine('ELIBACC') }}}: 'Can   access a needed shared lib',
    {{{ cDefine('ELIBBAD') }}}: 'Accessing a corrupted shared lib',
    {{{ cDefine('ELIBSCN') }}}: '.lib section in a.out corrupted',
    {{{ cDefine('ELIBMAX') }}}: 'Attempting to link in too many libs',
    {{{ cDefine('ELIBEXEC') }}}: 'Attempting to exec a shared library',
    {{{ cDefine('ENOSYS') }}}: 'Function not implemented',
    {{{ cDefine('ENOTEMPTY') }}}: 'Directory not empty',
    {{{ cDefine('ENAMETOOLONG') }}}: 'File or path name too long',
    {{{ cDefine('ELOOP') }}}: 'Too many symbolic links',
    {{{ cDefine('EOPNOTSUPP') }}}: 'Operation not supported on transport endpoint',
    {{{ cDefine('EPFNOSUPPORT') }}}: 'Protocol family not supported',
    {{{ cDefine('ECONNRESET') }}}: 'Connection reset by peer',
    {{{ cDefine('ENOBUFS') }}}: 'No buffer space available',
    {{{ cDefine('EAFNOSUPPORT') }}}: 'Address family not supported by protocol family',
    {{{ cDefine('EPROTOTYPE') }}}: 'Protocol wrong type for socket',
    {{{ cDefine('ENOTSOCK') }}}: 'Socket operation on non-socket',
    {{{ cDefine('ENOPROTOOPT') }}}: 'Protocol not available',
    {{{ cDefine('ESHUTDOWN') }}}: 'Can\'t send after socket shutdown',
    {{{ cDefine('ECONNREFUSED') }}}: 'Connection refused',
    {{{ cDefine('EADDRINUSE') }}}: 'Address already in use',
    {{{ cDefine('ECONNABORTED') }}}: 'Connection aborted',
    {{{ cDefine('ENETUNREACH') }}}: 'Network is unreachable',
    {{{ cDefine('ENETDOWN') }}}: 'Network interface is not configured',
    {{{ cDefine('ETIMEDOUT') }}}: 'Connection timed out',
    {{{ cDefine('EHOSTDOWN') }}}: 'Host is down',
    {{{ cDefine('EHOSTUNREACH') }}}: 'Host is unreachable',
    {{{ cDefine('EINPROGRESS') }}}: 'Connection already in progress',
    {{{ cDefine('EALREADY') }}}: 'Socket already connected',
    {{{ cDefine('EDESTADDRREQ') }}}: 'Destination address required',
    {{{ cDefine('EMSGSIZE') }}}: 'Message too long',
    {{{ cDefine('EPROTONOSUPPORT') }}}: 'Unknown protocol',
    {{{ cDefine('ESOCKTNOSUPPORT') }}}: 'Socket type not supported',
    {{{ cDefine('EADDRNOTAVAIL') }}}: 'Address not available',
    {{{ cDefine('ENETRESET') }}}: 'Connection reset by network',
    {{{ cDefine('EISCONN') }}}: 'Socket is already connected',
    {{{ cDefine('ENOTCONN') }}}: 'Socket is not connected',
    {{{ cDefine('ETOOMANYREFS') }}}: 'Too many references',
    {{{ cDefine('EUSERS') }}}: 'Too many users',
    {{{ cDefine('EDQUOT') }}}: 'Quota exceeded',
    {{{ cDefine('ESTALE') }}}: 'Stale file handle',
    {{{ cDefine('ENOTSUP') }}}: 'Not supported',
    {{{ cDefine('ENOMEDIUM') }}}: 'No medium (in tape drive)',
    {{{ cDefine('EILSEQ') }}}: 'Illegal byte sequence',
    {{{ cDefine('EOVERFLOW') }}}: 'Value too large for defined data type',
    {{{ cDefine('ECANCELED') }}}: 'Operation canceled',
    {{{ cDefine('ENOTRECOVERABLE') }}}: 'State not recoverable',
    {{{ cDefine('EOWNERDEAD') }}}: 'Previous owner died',
    {{{ cDefine('ESTRPIPE') }}}: 'Streams pipe error',
  },
  __errno_state: 0,
  __setErrNo__deps: ['__errno_state'],
  __setErrNo__postset: '___errno_state = Runtime.staticAlloc(4); {{{ makeSetValue("___errno_state", 0, 0, "i32") }}};',
  __setErrNo: function(value) {
    // For convenient setting and returning of errno.
    {{{ makeSetValue('___errno_state', '0', 'value', 'i32') }}}
    return value;
  },
  __errno_location__deps: ['__setErrNo'],
  __errno_location: function() {
    return ___errno_state;
  },
  __errno: '__errno_location',

  // ==========================================================================
  // netdb.h
  // ==========================================================================

  // All we can do is alias names to ips. you give this a name, it returns an
  // "ip" that we later know to use as a name. There is no way to do actual
  // name resolving clientside in a browser.
  // we do the aliasing in 172.29.*.*, giving us 65536 possibilities
  // note: lots of leaking here!
  __hostent_struct_layout: Runtime.generateStructInfo([
    ['i8*', 'h_name'],
    ['i8**', 'h_aliases'],
    ['i32', 'h_addrtype'],
    ['i32', 'h_length'],
    ['i8**', 'h_addr_list'],
  ]),

  gethostbyname__deps: ['__hostent_struct_layout'],
  gethostbyname: function(name) {
    name = Pointer_stringify(name);
      if (!_gethostbyname.id) {
        _gethostbyname.id = 1;
        _gethostbyname.table = {};
      }
    var id = _gethostbyname.id++;
    assert(id < 65535);
    var fakeAddr = 172 | (29 << 8) | ((id & 0xff) << 16) | ((id & 0xff00) << 24);
    _gethostbyname.table[id] = name;
    // generate hostent
    var ret = _malloc(___hostent_struct_layout.__size__);
    var nameBuf = _malloc(name.length+1);
    writeStringToMemory(name, nameBuf);
    setValue(ret+___hostent_struct_layout.h_name, nameBuf, 'i8*');
    var aliasesBuf = _malloc(4);
    setValue(aliasesBuf, 0, 'i8*');
    setValue(ret+___hostent_struct_layout.h_aliases, aliasesBuf, 'i8**');
    setValue(ret+___hostent_struct_layout.h_addrtype, {{{ cDefine('AF_INET') }}}, 'i32');
    setValue(ret+___hostent_struct_layout.h_length, 4, 'i32');
    var addrListBuf = _malloc(12);
    setValue(addrListBuf, addrListBuf+8, 'i32*');
    setValue(addrListBuf+4, 0, 'i32*');
    setValue(addrListBuf+8, fakeAddr, 'i32');
    setValue(ret+___hostent_struct_layout.h_addr_list, addrListBuf, 'i8**');
    return ret;
  },

  gethostbyname_r__deps: ['gethostbyname'],
  gethostbyname_r: function(name, hostData, buffer, bufferSize, hostEntry, errnum) {
    var data = _gethostbyname(name);
    _memcpy(hostData, data, ___hostent_struct_layout.__size__);
    _free(data);
    setValue(errnum, 0, 'i32');
    return 0;
  },

  // ==========================================================================
  // sockets. Note that the implementation assumes all sockets are always
  // nonblocking
  // ==========================================================================
#if SOCKET_WEBRTC
  $Sockets__deps: ['__setErrNo', '$ERRNO_CODES',
    function() { return 'var SocketIO = ' + read('socket.io.js') + ';\n' },
    function() { return 'var Peer = ' + read('wrtcp.js') + ';\n' }],
#else
  $Sockets__deps: ['__setErrNo', '$ERRNO_CODES'],
#endif
  $Sockets: {
    BUFFER_SIZE: 10*1024, // initial size
    MAX_BUFFER_SIZE: 10*1024*1024, // maximum size we will grow the buffer

    nextFd: 1,
    fds: {},
    nextport: 1,
    maxport: 65535,
    peer: null,
    connections: {},
    portmap: {},
    localAddr: 0xfe00000a, // Local address is always 10.0.0.254
    addrPool: [            0x0200000a, 0x0300000a, 0x0400000a, 0x0500000a,
               0x0600000a, 0x0700000a, 0x0800000a, 0x0900000a, 0x0a00000a,
               0x0b00000a, 0x0c00000a, 0x0d00000a, 0x0e00000a], /* 0x0100000a is reserved */
    sockaddr_in_layout: Runtime.generateStructInfo([
      ['i32', 'sin_family'],
      ['i16', 'sin_port'],
      ['i32', 'sin_addr'],
      ['i32', 'sin_zero'],
      ['i16', 'sin_zero_b'],
    ]),
    msghdr_layout: Runtime.generateStructInfo([
      ['*', 'msg_name'],
      ['i32', 'msg_namelen'],
      ['*', 'msg_iov'],
      ['i32', 'msg_iovlen'],
      ['*', 'msg_control'],
      ['i32', 'msg_controllen'],
      ['i32', 'msg_flags'],
    ]),
  },

#if SOCKET_WEBRTC
  /* WebRTC sockets supports several options on the Module object.

     * Module['host']: true if this peer is hosting, false otherwise
     * Module['webrtc']['broker']: hostname for the p2p broker that this peer should use
     * Module['webrtc']['session']: p2p session for that this peer will join, or undefined if this peer is hosting
     * Module['webrtc']['hostOptions']: options to pass into p2p library if this peer is hosting
     * Module['webrtc']['onpeer']: function(peer, route), invoked when this peer is ready to connect
     * Module['webrtc']['onconnect']: function(peer), invoked when a new peer connection is ready
     * Module['webrtc']['ondisconnect']: function(peer), invoked when an existing connection is closed
     * Module['webrtc']['onerror']: function(error), invoked when an error occurs
   */
  __sys_socket__deps: ['$FS', '$Sockets'],
  __sys_socket: function(family, type, protocol) {
    var INCOMING_QUEUE_LENGTH = 64;
    var info = FS.createStream({
      addr: null,
      port: null,
      inQueue: new CircularBuffer(INCOMING_QUEUE_LENGTH),
      header: new Uint16Array(2),
      bound: false,
      socket: true,
      stream_ops: {}
    });
    assert(info.fd < 64); // select() assumes socket fd values are in 0..63
    var stream = type == {{{ cDefine('SOCK_STREAM') }}};
    if (protocol) {
      assert(stream == (protocol == {{{ cDefine('IPPROTO_TCP') }}})); // if stream, must be tcp
    }

    // Open the peer connection if we don't have it already
    if (null == Sockets.peer) {
      var host = Module['host'];
      var broker = Module['webrtc']['broker'];
      var session = Module['webrtc']['session'];
      var peer = new Peer(broker);
      var listenOptions = Module['webrtc']['hostOptions'] || {};
      peer.onconnection = function(connection) {
        console.log('connected');
        var addr;
        /* If this peer is connecting to the host, assign 10.0.0.1 to the host so it can be
           reached at a known address.
         */
        // Assign 10.0.0.1 to the host
        if (session && session === connection['route']) {
          addr = 0x0100000a; // 10.0.0.1
        } else {
          addr = Sockets.addrPool.shift();
        }
        connection['addr'] = addr;
        Sockets.connections[addr] = connection;
        connection.ondisconnect = function() {
          console.log('disconnect');
          // Don't return the host address (10.0.0.1) to the pool
          if (!(session && session === Sockets.connections[addr]['route'])) {
            Sockets.addrPool.push(addr);
          }
          delete Sockets.connections[addr];

          if (Module['webrtc']['ondisconnect'] && 'function' === typeof Module['webrtc']['ondisconnect']) {
            Module['webrtc']['ondisconnect'](peer);
          }
        };
        connection.onerror = function(error) {
          if (Module['webrtc']['onerror'] && 'function' === typeof Module['webrtc']['onerror']) {
            Module['webrtc']['onerror'](error);
          }
        };
        connection.onmessage = function(label, message) {
          if ('unreliable' === label) {
            handleMessage(addr, message.data);
          }
        }

        if (Module['webrtc']['onconnect'] && 'function' === typeof Module['webrtc']['onconnect']) {
          Module['webrtc']['onconnect'](peer);
        }
      };
      peer.onpending = function(pending) {
        console.log('pending from: ', pending['route'], '; initiated by: ', (pending['incoming']) ? 'remote' : 'local');
      };
      peer.onerror = function(error) {
        console.error(error);
      };
      peer.onroute = function(route) {
        if (Module['webrtc']['onpeer'] && 'function' === typeof Module['webrtc']['onpeer']) {
          Module['webrtc']['onpeer'](peer, route);
        }
      };
      function handleMessage(addr, message) {
#if SOCKET_DEBUG
        Module.print("received " + message.byteLength + " raw bytes");
#endif
        var header = new Uint16Array(message, 0, 2);
        if (Sockets.portmap[header[1]]) {
          Sockets.portmap[header[1]].inQueue.push([addr, message]);
        } else {
          console.log("unable to deliver message: ", addr, header[1], message);
        }
      }
      window.onbeforeunload = function() {
        var ids = Object.keys(Sockets.connections);
        ids.forEach(function(id) {
          Sockets.connections[id].close();
        });
      }
      Sockets.peer = peer;
    }

    function CircularBuffer(max_length) {
      var buffer = new Array(++ max_length);
      var head = 0;
      var tail = 0;
      var length = 0;

      return {
        push: function(element) {
          buffer[tail ++] = element;
          length = Math.min(++ length, max_length - 1);
          tail = tail % max_length;
          if (tail === head) {
            head = (head + 1) % max_length;
          }
        },
        shift: function(element) {
          if (length < 1) return undefined;

          var element = buffer[head];
          -- length;
          head = (head + 1) % max_length;
          return element;
        },
        length: function() {
          return length;
        }
      };
    };
    return info.fd;
  },

  mkport__deps: ['$Sockets'],
  mkport: function() {
    for(var i = 0; i < Sockets.maxport; ++ i) {
      var port = Sockets.nextport ++;
      Sockets.nextport = (Sockets.nextport > Sockets.maxport) ? 1 : Sockets.nextport;
      if (!Sockets.portmap[port]) {
        return port;
      }
    }
    assert(false, 'all available ports are in use!');
  },

  __sys_connect: function() {
    // Stub: connection-oriented sockets are not supported yet.
  },

  __sys_bind__deps: ['$FS', '$Sockets', '_inet_ntoa_raw', 'ntohs', 'mkport'],
  __sys_bind: function(fd, addr, addrlen) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    if (addr) {
      info.port = _ntohs(getValue(addr + Sockets.sockaddr_in_layout.sin_port, 'i16'));
      // info.addr = getValue(addr + Sockets.sockaddr_in_layout.sin_addr, 'i32');
    }
    if (!info.port) {
      info.port = _mkport();
    }
    info.addr = Sockets.localAddr; // 10.0.0.254
    info.host = __inet_ntoa_raw(info.addr);
    info.close = function() {
      Sockets.portmap[info.port] = undefined;
    }
    Sockets.portmap[info.port] = info;
    console.log("bind: ", info.host, info.port);
    info.bound = true;
  },

  __sys_sendmsg__deps: ['$FS', '$Sockets', '__sys_bind', '_inet_ntoa_raw', 'ntohs'],
  __sys_sendmsg: function(fd, msg, flags) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    // if we are not connected, use the address info in the message
    if (!info.bound) {
      ___sys_bind(fd);
    }

    var name = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_name', '*') }}};
    assert(name, 'sendmsg on non-connected socket, and no name/address in the message');
    var port = _ntohs(getValue(name + Sockets.sockaddr_in_layout.sin_port, 'i16'));
    var addr = getValue(name + Sockets.sockaddr_in_layout.sin_addr, 'i32');
    var connection = Sockets.connections[addr];
    // var host = __inet_ntoa_raw(addr);

    if (!(connection && connection.connected)) {
      ___setErrNo(ERRNO_CODES.EWOULDBLOCK);
      return -1;
    }

    var iov = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_iov', 'i8*') }}};
    var num = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_iovlen', 'i32') }}};
#if SOCKET_DEBUG
    Module.print('sendmsg vecs: ' + num);
#endif
    var totalSize = 0;
    for (var i = 0; i < num; i++) {
      totalSize += {{{ makeGetValue('iov', '8*i + 4', 'i32') }}};
    }
    var data = new Uint8Array(totalSize);
    var ret = 0;
    for (var i = 0; i < num; i++) {
      var currNum = {{{ makeGetValue('iov', '8*i + 4', 'i32') }}};
#if SOCKET_DEBUG
    Module.print('sendmsg curr size: ' + currNum);
#endif
      if (!currNum) continue;
      var currBuf = {{{ makeGetValue('iov', '8*i', 'i8*') }}};
      data.set(HEAPU8.subarray(currBuf, currBuf+currNum), ret);
      ret += currNum;
    }

    info.header[0] = info.port; // src port
    info.header[1] = port; // dst port
#if SOCKET_DEBUG
    Module.print('sendmsg port: ' + info.header[0] + ' -> ' + info.header[1]);
    Module.print('sendmsg bytes: ' + data.length + ' | ' + Array.prototype.slice.call(data));
#endif
    var buffer = new Uint8Array(info.header.byteLength + data.byteLength);
    buffer.set(new Uint8Array(info.header.buffer));
    buffer.set(data, info.header.byteLength);

    connection.send('unreliable', buffer.buffer);
    return ret;
  },

  __sys_recvmsg__deps: ['$FS', '$Sockets', '__sys_bind', '__setErrNo', '$ERRNO_CODES', 'htons'],
  __sys_recvmsg: function(fd, msg, flags) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    // if we are not connected, use the address info in the message
    if (!info.port) {
      console.log('recvmsg on unbound socket');
      assert(false, 'cannot receive on unbound socket');
    }
    if (info.inQueue.length() == 0) {
      ___setErrNo(ERRNO_CODES.EWOULDBLOCK);
      return -1;
    }

    var entry = info.inQueue.shift();
    var addr = entry[0];
    var message = entry[1];
    var header = new Uint16Array(message, 0, info.header.length);
    var buffer = new Uint8Array(message, info.header.byteLength);

    var bytes = buffer.length;
#if SOCKET_DEBUG
    Module.print('recvmsg port: ' + header[1] + ' <- ' + header[0]);
    Module.print('recvmsg bytes: ' + bytes + ' | ' + Array.prototype.slice.call(buffer));
#endif
    // write source
    var name = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_name', '*') }}};
    {{{ makeSetValue('name', 'Sockets.sockaddr_in_layout.sin_addr', 'addr', 'i32') }}};
    {{{ makeSetValue('name', 'Sockets.sockaddr_in_layout.sin_port', '_htons(header[0])', 'i16') }}};
    // write data
    var ret = bytes;
    var iov = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_iov', 'i8*') }}};
    var num = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_iovlen', 'i32') }}};
    var bufferPos = 0;
    for (var i = 0; i < num && bytes > 0; i++) {
      var currNum = {{{ makeGetValue('iov', '8*i + 4', 'i32') }}};
#if SOCKET_DEBUG
      Module.print('recvmsg loop ' + [i, num, bytes, currNum]);
#endif
      if (!currNum) continue;
      currNum = Math.min(currNum, bytes); // XXX what should happen when we partially fill a buffer..?
      bytes -= currNum;
      var currBuf = {{{ makeGetValue('iov', '8*i', 'i8*') }}};
#if SOCKET_DEBUG
      Module.print('recvmsg call recv ' + currNum);
#endif
      HEAPU8.set(buffer.subarray(bufferPos, bufferPos + currNum), currBuf);
      bufferPos += currNum;
    }
    return ret;
  },

  __sys_shutdown__deps: ['$FS'],
  __sys_shutdown: function(fd, how) {
    var stream = FS.getStream(fd);
    if (!stream) return -1;
    stream.close();
    FS.closeStream(stream);
  },

  __sys_ioctl__deps: ['$FS'],
  __sys_ioctl: function(fd, request, varargs) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    var bytes = 0;
    if (info.hasData()) {
      bytes = info.inQueue[0].length;
    }
    var dest = {{{ makeGetValue('varargs', '0', 'i32') }}};
    {{{ makeSetValue('dest', '0', 'bytes', 'i32') }}};
    return 0;
  },

  __sys_setsockopt: function(d, level, optname, optval, optlen) {
    console.log('ignoring setsockopt command');
    return 0;
  },

  __sys_accept__deps: ['$FS'],
  __sys_accept: function(fd, addr, addrlen) {
    // TODO: webrtc queued incoming connections, etc.
    // For now, the model is that bind does a connect, and we "accept" that one connection,
    // which has host:port the same as ours. We also return the same socket fd.
    var info = FS.getStream(fd);
    if (!info) return -1;
    if (addr) {
      setValue(addr + Sockets.sockaddr_in_layout.sin_addr, info.addr, 'i32');
      setValue(addr + Sockets.sockaddr_in_layout.sin_port, info.port, 'i32');
      setValue(addrlen, Sockets.sockaddr_in_layout.__size__, 'i32');
    }
    return fd;
  },

  __sys_select__deps: ['$FS'],
  __sys_select: function(nfds, readfds, writefds, exceptfds, timeout) {
    // readfds are supported,
    // writefds checks socket open status
    // exceptfds not supported
    // timeout is always 0 - fully async
    assert(!exceptfds);

    var errorCondition = 0;

    function canRead(info) {
      return info.inQueue.length() > 0;
    }

    function canWrite(info) {
      return true;
    }

    function checkfds(nfds, fds, can) {
      if (!fds) return 0;

      var bitsSet = 0;
      var dstLow  = 0;
      var dstHigh = 0;
      var srcLow  = {{{ makeGetValue('fds', 0, 'i32') }}};
      var srcHigh = {{{ makeGetValue('fds', 4, 'i32') }}};
      nfds = Math.min(64, nfds); // fd sets have 64 bits

      for (var fd = 0; fd < nfds; fd++) {
        var mask = 1 << (fd % 32), int_ = fd < 32 ? srcLow : srcHigh;
        if (int_ & mask) {
          // index is in the set, check if it is ready for read
          var info = FS.getStream(fd);
          if (info && can(info)) {
            // set bit
            fd < 32 ? (dstLow = dstLow | mask) : (dstHigh = dstHigh | mask);
            bitsSet++;
          }
        }
      }

      {{{ makeSetValue('fds', 0, 'dstLow', 'i32') }}};
      {{{ makeSetValue('fds', 4, 'dstHigh', 'i32') }}};
      return bitsSet;
    }

    var totalHandles = checkfds(nfds, readfds, canRead) + checkfds(nfds, writefds, canWrite);
    if (errorCondition) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    } else {
      return totalHandles;
    }
  },
#else
  __sys_socket__deps: ['$FS', '$Sockets'],
  __sys_socket: function(family, type, protocol) {
    var stream = type == {{{ cDefine('SOCK_STREAM') }}};
    if (protocol) {
      assert(stream == (protocol == {{{ cDefine('IPPROTO_TCP') }}})); // if SOCK_STREAM, must be tcp
    }
    var stream = FS.createStream({
      connected: false,
      stream: stream,
      socket: true,
      stream_ops: {}
    });
    assert(stream.fd < 64); // select() assumes socket fd values are in 0..63
    return stream.fd;
  },

  __sys_connect__deps: ['$FS', '$Sockets', '_inet_ntoa_raw', 'ntohs', 'gethostbyname'],
  __sys_connect: function(fd, addr, addrlen) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    info.connected = true;
    info.addr = getValue(addr + Sockets.sockaddr_in_layout.sin_addr, 'i32');
    info.port = _htons(getValue(addr + Sockets.sockaddr_in_layout.sin_port, 'i16'));
    info.host = __inet_ntoa_raw(info.addr);
    // Support 'fake' ips from gethostbyname
    var parts = info.host.split('.');
    if (parts[0] == '172' && parts[1] == '29') {
      var low = Number(parts[2]);
      var high = Number(parts[3]);
      info.host = _gethostbyname.table[low + 0xff*high];
      assert(info.host, 'problem translating fake ip ' + parts);
    }
    try {
      console.log('opening ws://' + info.host + ':' + info.port);
      info.socket = new WebSocket('ws://' + info.host + ':' + info.port, ['binary']);
      info.socket.binaryType = 'arraybuffer';

      var i32Temp = new Uint32Array(1);
      var i8Temp = new Uint8Array(i32Temp.buffer);

      info.inQueue = [];
      info.hasData = function() { return info.inQueue.length > 0 }
      if (!info.stream) {
        var partialBuffer = null; // in datagram mode, inQueue contains full dgram messages; this buffers incomplete data. Must begin with the beginning of a message
      }

      info.socket.onmessage = function(event) {
        assert(typeof event.data !== 'string' && event.data.byteLength); // must get binary data!
        var data = new Uint8Array(event.data); // make a typed array view on the array buffer
#if SOCKET_DEBUG
        Module.print(['onmessage', data.length, '|', Array.prototype.slice.call(data)]);
#endif
        if (info.stream) {
          info.inQueue.push(data);
        } else {
          // we added headers with message sizes, read those to find discrete messages
          if (partialBuffer) {
            // append to the partial buffer
            var newBuffer = new Uint8Array(partialBuffer.length + data.length);
            newBuffer.set(partialBuffer);
            newBuffer.set(data, partialBuffer.length);
            // forget the partial buffer and work on data
            data = newBuffer;
            partialBuffer = null;
          }
          var currPos = 0;
          while (currPos+4 < data.length) {
            i8Temp.set(data.subarray(currPos, currPos+4));
            var currLen = i32Temp[0];
            assert(currLen > 0);
            if (currPos + 4 + currLen > data.length) {
              break; // not enough data has arrived
            }
            currPos += 4;
#if SOCKET_DEBUG
            Module.print(['onmessage message', currLen, '|', Array.prototype.slice.call(data.subarray(currPos, currPos+currLen))]);
#endif
            info.inQueue.push(data.subarray(currPos, currPos+currLen));
            currPos += currLen;
          }
          // If data remains, buffer it
          if (currPos < data.length) {
            partialBuffer = data.subarray(currPos);
          }
        }
      }
      function send(data) {
        // TODO: if browser accepts views, can optimize this
#if SOCKET_DEBUG
        Module.print('sender actually sending ' + Array.prototype.slice.call(data));
#endif
        // ok to use the underlying buffer, we created data and know that the buffer starts at the beginning
        info.socket.send(data.buffer);
      }
      var outQueue = [];
      var intervalling = false, interval;
      function trySend() {
        if (info.socket.readyState != info.socket.OPEN) {
          if (!intervalling) {
            intervalling = true;
            console.log('waiting for socket in order to send');
            interval = setInterval(trySend, 100);
          }
          return;
        }
        for (var i = 0; i < outQueue.length; i++) {
          send(outQueue[i]);
        }
        outQueue.length = 0;
        if (intervalling) {
          intervalling = false;
          clearInterval(interval);
        }
      }
      info.sender = function(data) {
        if (!info.stream) {
          // add a header with the message size
          var header = new Uint8Array(4);
          i32Temp[0] = data.length;
          header.set(i8Temp);
          outQueue.push(header);
        }
        outQueue.push(new Uint8Array(data));
        trySend();
      };
    } catch(e) {
      Module.printErr('Error in connect(): ' + e);
      ___setErrNo(ERRNO_CODES.EACCES);
      return -1;
    }

    // always "fail" in non-blocking mode
    ___setErrNo(ERRNO_CODES.EINPROGRESS);
    return -1;
  },

  __sys_recv__deps: ['$FS'],
  __sys_recv: function(fd, buf, len, flags) {
    var info = FS.getStream(fd);
    if (!info) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
#if SOCKET_WEBRTC == 0
    if (!info.hasData()) {
      if (info.socket.readyState === WebSocket.CLOSING || info.socket.readyState === WebSocket.CLOSED) {
        // socket has closed
        return 0;
      } else {
        // else, our socket is in a valid state but truly has nothing available
        ___setErrNo(ERRNO_CODES.EAGAIN);
        return -1;
      }
    }
#endif
    var buffer = info.inQueue.shift();
#if SOCKET_DEBUG
    Module.print('recv: ' + [Array.prototype.slice.call(buffer)]);
#endif
    if (len < buffer.length) {
      if (info.stream) {
        // This is tcp (reliable), so if not all was read, keep it
        info.inQueue.unshift(buffer.subarray(len));
#if SOCKET_DEBUG
        Module.print('recv: put back: ' + (len - buffer.length));
#endif
      }
      buffer = buffer.subarray(0, len);
    }
    HEAPU8.set(buffer, buf);
    return buffer.length;
  },

  __sys_send__deps: ['$FS'],
  __sys_send: function(fd, buf, len, flags) {
    var info = FS.getStream(fd);
    if (!info) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
#if SOCKET_WEBRTC == 0
    if (info.socket.readyState === WebSocket.CLOSING || info.socket.readyState === WebSocket.CLOSED) {
      ___setErrNo(ERRNO_CODES.ENOTCONN);
      return -1;
    } else if (info.socket.readyState === WebSocket.CONNECTING) {
      ___setErrNo(ERRNO_CODES.EAGAIN);
      return -1;
    }
#endif
    info.sender(HEAPU8.subarray(buf, buf+len));
    return len;
  },

  __sys_sendmsg__deps: ['$FS', '$Sockets', 'connect'],
  __sys_sendmsg: function(fd, msg, flags) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    // if we are not connected, use the address info in the message
    if (!info.connected) {
      var name = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_name', '*') }}};
      assert(name, 'sendmsg on non-connected socket, and no name/address in the message');
      _connect(fd, name, {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_namelen', 'i32') }}});
    }
    var iov = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_iov', 'i8*') }}};
    var num = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_iovlen', 'i32') }}};
#if SOCKET_DEBUG
    Module.print('sendmsg vecs: ' + num);
#endif
    var totalSize = 0;
    for (var i = 0; i < num; i++) {
      totalSize += {{{ makeGetValue('iov', '8*i + 4', 'i32') }}};
    }
    var buffer = new Uint8Array(totalSize);
    var ret = 0;
    for (var i = 0; i < num; i++) {
      var currNum = {{{ makeGetValue('iov', '8*i + 4', 'i32') }}};
#if SOCKET_DEBUG
      Module.print('sendmsg curr size: ' + currNum);
#endif
      if (!currNum) continue;
      var currBuf = {{{ makeGetValue('iov', '8*i', 'i8*') }}};
      buffer.set(HEAPU8.subarray(currBuf, currBuf+currNum), ret);
      ret += currNum;
    }
    info.sender(buffer); // send all the iovs as a single message
    return ret;
  },

  __sys_recvmsg__deps: ['$FS', '$Sockets', '__sys_connect', '__sys_recv', '__setErrNo', '$ERRNO_CODES', 'htons'],
  __sys_recvmsg: function(fd, msg, flags) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    // if we are not connected, use the address info in the message
    if (!info.connected) {
#if SOCKET_DEBUG
    Module.print('recvmsg connecting');
#endif
      var name = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_name', '*') }}};
      assert(name, 'sendmsg on non-connected socket, and no name/address in the message');
      ___sys_connect(fd, name, {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_namelen', 'i32') }}});
    }
    if (!info.hasData()) {
      ___setErrNo(ERRNO_CODES.EWOULDBLOCK);
      return -1;
    }
    var buffer = info.inQueue.shift();
    var bytes = buffer.length;
#if SOCKET_DEBUG
    Module.print('recvmsg bytes: ' + bytes);
#endif
    // write source
    var name = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_name', '*') }}};
    {{{ makeSetValue('name', 'Sockets.sockaddr_in_layout.sin_addr', 'info.addr', 'i32') }}};
    {{{ makeSetValue('name', 'Sockets.sockaddr_in_layout.sin_port', '_htons(info.port)', 'i16') }}};
    // write data
    var ret = bytes;
    var iov = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_iov', 'i8*') }}};
    var num = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_iovlen', 'i32') }}};
    var bufferPos = 0;
    for (var i = 0; i < num && bytes > 0; i++) {
      var currNum = {{{ makeGetValue('iov', '8*i + 4', 'i32') }}};
#if SOCKET_DEBUG
      Module.print('recvmsg loop ' + [i, num, bytes, currNum]);
#endif
      if (!currNum) continue;
      currNum = Math.min(currNum, bytes); // XXX what should happen when we partially fill a buffer..?
      bytes -= currNum;
      var currBuf = {{{ makeGetValue('iov', '8*i', 'i8*') }}};
#if SOCKET_DEBUG
      Module.print('recvmsg call recv ' + currNum);
#endif
      HEAPU8.set(buffer.subarray(bufferPos, bufferPos + currNum), currBuf);
      bufferPos += currNum;
    }
    if (info.stream) {
      // This is tcp (reliable), so if not all was read, keep it
      if (bufferPos < bytes) {
        info.inQueue.unshift(buffer.subarray(bufferPos));
#if SOCKET_DEBUG
        Module.print('recvmsg: put back: ' + (bytes - bufferPos));
#endif
      }
    }
    return ret;
  },

  __sys_recvfrom__deps: ['$FS', '__sys_connect', '__sys_recv'],
  __sys_recvfrom: function(fd, buf, len, flags, addr, addrlen) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    // if we are not connected, use the address info in the message
    if (!info.connected) {
      //var name = {{{ makeGetValue('addr', '0', '*') }}};
      ___sys_connect(fd, addr, addrlen);
    }
    return ___sys_recv(fd, buf, len, flags);
  },

  __sys_shutdown__deps: ['$FS'],
  __sys_shutdown: function(fd, how) {
    var stream = FS.getStream(fd);
    if (!stream) return -1;
    stream.socket.close();
    FS.closeStream(stream);
  },

  __sys_ioctl__deps: ['$FS'],
  __sys_ioctl: function(fd, request, varargs) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    var bytes = 0;
    if (info.hasData()) {
      bytes = info.inQueue[0].length;
    }
    var dest = {{{ makeGetValue('varargs', '0', 'i32') }}};
    {{{ makeSetValue('dest', '0', 'bytes', 'i32') }}};
    return 0;
  },

  __sys_setsockopt: function(d, level, optname, optval, optlen) {
    console.log('ignoring setsockopt command');
    return 0;
  },

  __sys_bind__deps: ['__sys_connect'],
  __sys_bind: function(fd, addr, addrlen) {
    _connect(fd, addr, addrlen);
    return 0;
  },

  __sys_listen: function(fd, backlog) {
    return 0;
  },

  __sys_accept__deps: ['$FS', '$Sockets'],
  __sys_accept: function(fd, addr, addrlen) {
    // TODO: webrtc queued incoming connections, etc.
    // For now, the model is that bind does a connect, and we "accept" that one connection,
    // which has host:port the same as ours. We also return the same socket fd.
    var info = FS.getStream(fd);
    if (!info) return -1;
    if (addr) {
      setValue(addr + Sockets.sockaddr_in_layout.sin_addr, info.addr, 'i32');
      setValue(addr + Sockets.sockaddr_in_layout.sin_port, info.port, 'i32');
      setValue(addrlen, Sockets.sockaddr_in_layout.__size__, 'i32');
    }
    return fd;
  },

  __sys_select__deps: ['$FS'],
  __sys_select: function(nfds, readfds, writefds, exceptfds, timeout) {
    // readfds are supported,
    // writefds checks socket open status
    // exceptfds not supported
    // timeout is always 0 - fully async
    assert(!exceptfds);

    var errorCondition = 0;

    function canRead(info) {
      return (info.hasData && info.hasData()) ||
        info.socket.readyState == WebSocket.CLOSING ||  // let recv return 0 once closed
        info.socket.readyState == WebSocket.CLOSED;
    }

    function canWrite(info) {
      return info.socket && (info.socket.readyState == info.socket.OPEN);
    }

    function checkfds(nfds, fds, can) {
      if (!fds) return 0;

      var bitsSet = 0;
      var dstLow  = 0;
      var dstHigh = 0;
      var srcLow  = {{{ makeGetValue('fds', 0, 'i32') }}};
      var srcHigh = {{{ makeGetValue('fds', 4, 'i32') }}};
      nfds = Math.min(64, nfds); // fd sets have 64 bits

      for (var fd = 0; fd < nfds; fd++) {
        var mask = 1 << (fd % 32), int_ = fd < 32 ? srcLow : srcHigh;
        if (int_ & mask) {
          // index is in the set, check if it is ready for read
          var info = FS.getStream(fd);
          if (!info) {
            ___setErrNo(ERRNO_CODES.EBADF);
            return -1;
          }
          if (can(info)) {
            // set bit
            fd < 32 ? (dstLow = dstLow | mask) : (dstHigh = dstHigh | mask);
            bitsSet++;
          }
        }
      }

      {{{ makeSetValue('fds', 0, 'dstLow', 'i32') }}};
      {{{ makeSetValue('fds', 4, 'dstHigh', 'i32') }}};
      return bitsSet;
    }

    var totalHandles = checkfds(nfds, readfds, canRead) + checkfds(nfds, writefds, canWrite);
    if (errorCondition) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    } else {
      return totalHandles;
    }
  },
#endif

  __sys_socketpair__deps: ['__setErrNo', '$ERRNO_CODES'],
  __sys_socketpair: function(domain, type, protocol, sv) {
    // int socketpair(int domain, int type, int protocol, int sv[2]);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/socketpair.html
    ___setErrNo(ERRNO_CODES.EOPNOTSUPP);
    return -1;
  },

  // ==========================================================================
  // sys/syscall.h
  // ==========================================================================

  __sys_unimplemented__deps: ['__setErrNo', '$ERRNO_CODES'],
  __sys_unimplemented: function() {
    ___setErrNo(ERRNO_CODES.ENOSYS);
    return -1;
  },
  __sys_pretend_to_success: function() {
    return 0;
  },
  $SYSCALL_TABLE__deps: [
    '__sys_unimplemented',
    '__sys_pretend_to_success',
    '__sys_exit',
    '__sys_read',
    '__sys_write',
    '__sys_open',
    '__sys_close',
    '__sys_link',
    '__sys_unlink',
    '__sys_execve',
    '__sys_chdir',
    '__sys_mknod',
    '__sys_chmod',
    '__sys_lchown',
    '__sys_lseek',
    '__sys_getpid',
    '__sys_getuid',
    '__sys_access',
    '__sys_mkdir',
    '__sys_rmdir',
    '__sys_dup',
    '__sys_times',
    '__sys_brk',
    '__sys_getgid',
    '__sys_geteuid',
    '__sys_getegid',
    '__sys_ioctl',
    '__sys_fcntl',
    '__sys_umask',
    '__sys_dup2',
    '__sys_getppid',
    '__sys_getpgrp',
    '__sys_getgroups',
    '__sys_setgroups',
    '__sys_select',
    '__sys_symlink',
    '__sys_readlink',
    '__sys_mmap',
    '__sys_munmap',
    '__sys_truncate',
    '__sys_ftruncate',
    '__sys_fchmod',
    '__sys_fchown',
    '__sys_statfs',
    '__sys_fstatfs',
    '__sys_stat',
    '__sys_lstat',
    '__sys_fstat',
    '__sys_fsync',
    '__sys_uname',
    '__sys_getpgid',
    '__sys_fchdir',
    '__sys_getdents',
    '__sys_readv',
    '__sys_writev',
    '__sys_nanosleep',
    '__sys_poll',
    '__sys_pread',
    '__sys_pwrite',
    '__sys_chown',
    '__sys_getcwd',
    '__sys_fchmodat',
  ],
  $SYSCALL_TABLE: [
    '__sys_unimplemented',       // SYS_restart_syscall
    '__sys_exit',                // SYS_exit
    '__sys_unimplemented',       // SYS_fork
    '__sys_read',                // SYS_read
    '__sys_write',               // SYS_write
    '__sys_open',                // SYS_open
    '__sys_close',               // SYS_close
    '__sys_unimplemented',       // SYS_waitpid
    '__sys_unimplemented',       // SYS_creat
    '__sys_link',                // SYS_link
    '__sys_unlink',              // SYS_unlink
    '__sys_execve',              // SYS_execve
    '__sys_chdir',               // SYS_chdir
    '__sys_unimplemented',       // SYS_time
    '__sys_mknod',               // SYS_mknod
    '__sys_chmod',               // SYS_chmod
    '__sys_lchown',              // SYS_lchown
    '__sys_unimplemented',       // SYS_break
    '__sys_unimplemented',       // SYS_oldstat
    '__sys_lseek',               // SYS_lseek
    '__sys_getpid',              // SYS_getpid
    '__sys_unimplemented',       // SYS_mount
    '__sys_unimplemented',       // SYS_umount
    '__sys_unimplemented',       // SYS_setuid
    '__sys_getuid',              // SYS_getuid
    '__sys_unimplemented',       // SYS_stime
    '__sys_unimplemented',       // SYS_ptrace
    '__sys_unimplemented',       // SYS_alarm
    '__sys_unimplemented',       // SYS_oldfstat
    '__sys_unimplemented',       // SYS_pause
    '__sys_unimplemented',       // SYS_utime
    '__sys_unimplemented',       // SYS_stty
    '__sys_unimplemented',       // SYS_gtty
    '__sys_access',              // SYS_access
    '__sys_pretend_to_success',  // SYS_nice
    '__sys_unimplemented',       // SYS_ftime
    '__sys_pretend_to_success',  // SYS_sync
    '__sys_unimplemented',       // SYS_kill
    '__sys_unimplemented',       // SYS_rename
    '__sys_mkdir',               // SYS_mkdir
    '__sys_rmdir',               // SYS_rmdir
    '__sys_dup',                 // SYS_dup
    '__sys_unimplemented',       // SYS_pipe
    '__sys_times',               // SYS_times
    '__sys_unimplemented',       // SYS_prof
    '__sys_brk',                 // SYS_brk
    '__sys_unimplemented',       // SYS_setgid
    '__sys_getgid',              // SYS_getgid
    '__sys_unimplemented',       // SYS_signal
    '__sys_geteuid',             // SYS_geteuid
    '__sys_getegid',             // SYS_getegid
    '__sys_unimplemented',       // SYS_acct
    '__sys_unimplemented',       // SYS_umount2
    '__sys_pretend_to_success',  // SYS_lock
    '__sys_ioctl',               // SYS_ioctl
    '__sys_fcntl',               // SYS_fcntl
    '__sys_unimplemented',       // SYS_mpx
    '__sys_unimplemented',       // SYS_setpgid
    '__sys_unimplemented',       // SYS_ulimit
    '__sys_unimplemented',       // SYS_oldolduname
    '__sys_umask',               // SYS_umask
    '__sys_unimplemented',       // SYS_chroot
    '__sys_unimplemented',       // SYS_ustat
    '__sys_dup2',                // SYS_dup2
    '__sys_getppid',             // SYS_getppid
    '__sys_getpgrp',             // SYS_getpgrp
    '__sys_unimplemented',       // SYS_setsid
    '__sys_unimplemented',       // SYS_sigaction
    '__sys_unimplemented',       // SYS_sgetmask
    '__sys_unimplemented',       // SYS_ssetmask
    '__sys_unimplemented',       // SYS_setreuid
    '__sys_unimplemented',       // SYS_setregid
    '__sys_unimplemented',       // SYS_sigsuspend
    '__sys_unimplemented',       // SYS_sigpending
    '__sys_unimplemented',       // SYS_sethostname
    '__sys_unimplemented',       // SYS_setrlimit
    '__sys_unimplemented',       // SYS_getrlimit
    '__sys_unimplemented',       // SYS_getrusage
    '__sys_unimplemented',       // SYS_gettimeofday
    '__sys_unimplemented',       // SYS_settimeofday
    '__sys_getgroups',           // SYS_getgroups
    '__sys_setgroups',           // SYS_setgroups
    '__sys_select',              // SYS_select
    '__sys_symlink',             // SYS_symlink
    '__sys_unimplemented',       // SYS_oldlstat
    '__sys_readlink',            // SYS_readlink
    '__sys_unimplemented',       // SYS_uselib
    '__sys_unimplemented',       // SYS_swapon
    '__sys_unimplemented',       // SYS_reboot
    '__sys_unimplemented',       // SYS_readdir
    '__sys_mmap',                // SYS_mmap
    '__sys_munmap',              // SYS_munmap
    '__sys_truncate',            // SYS_truncate
    '__sys_ftruncate',           // SYS_ftruncate
    '__sys_fchmod',              // SYS_fchmod
    '__sys_fchown',              // SYS_fchown
    '__sys_unimplemented',       // SYS_getpriority
    '__sys_unimplemented',       // SYS_setpriority
    '__sys_unimplemented',       // SYS_profil
    '__sys_statfs',              // SYS_statfs
    '__sys_fstatfs',             // SYS_fstatfs
    '__sys_unimplemented',       // SYS_ioperm
    '__sys_unimplemented',       // SYS_socketcall
    '__sys_unimplemented',       // SYS_syslog
    '__sys_unimplemented',       // SYS_setitimer
    '__sys_unimplemented',       // SYS_getitimer
    '__sys_stat',                // SYS_stat
    '__sys_lstat',               // SYS_lstat
    '__sys_fstat',               // SYS_fstat
    '__sys_unimplemented',       // SYS_olduname
    '__sys_unimplemented',       // SYS_iopl
    '__sys_unimplemented',       // SYS_vhangup
    '__sys_unimplemented',       // SYS_idle
    '__sys_unimplemented',       // SYS_vm86old
    '__sys_unimplemented',       // SYS_wait4
    '__sys_unimplemented',       // SYS_swapoff
    '__sys_unimplemented',       // SYS_sysinfo
    '__sys_unimplemented',       // SYS_ipc
    '__sys_fsync',               // SYS_fsync
    '__sys_unimplemented',       // SYS_sigreturn
    '__sys_unimplemented',       // SYS_clone
    '__sys_unimplemented',       // SYS_setdomainname
    '__sys_uname',               // SYS_uname
    '__sys_unimplemented',       // SYS_modify_ldt
    '__sys_unimplemented',       // SYS_adjtimex
    '__sys_pretend_to_success',  // SYS_mprotect
    '__sys_unimplemented',       // SYS_sigprocmask
    '__sys_unimplemented',       // SYS_create_module
    '__sys_unimplemented',       // SYS_init_module
    '__sys_unimplemented',       // SYS_delete_module
    '__sys_unimplemented',       // SYS_get_kernel_syms
    '__sys_unimplemented',       // SYS_quotactl
    '__sys_getpgid',             // SYS_getpgid
    '__sys_fchdir',              // SYS_fchdir
    '__sys_unimplemented',       // SYS_bdflush
    '__sys_unimplemented',       // SYS_sysfs
    '__sys_unimplemented',       // SYS_personality
    '__sys_unimplemented',       // SYS_afs_syscall
    '__sys_unimplemented',       // SYS_setfsuid
    '__sys_unimplemented',       // SYS_setfsgid
    '__sys_unimplemented',       // SYS__llseek
    '__sys_getdents',            // SYS_getdents
    '__sys_unimplemented',       // SYS__newselect
    '__sys_pretend_to_success',  // SYS_flock
    '__sys_pretend_to_success',  // SYS_msync
    '__sys_readv',               // SYS_readv
    '__sys_writev',              // SYS_writev
    '__sys_unimplemented',       // SYS_getsid
    '__sys_pretend_to_success',  // SYS_fdatasync
    '__sys_unimplemented',       // SYS__sysctl
    '__sys_pretend_to_success',  // SYS_mlock
    '__sys_pretend_to_success',  // SYS_munlock
    '__sys_pretend_to_success',  // SYS_mlockall
    '__sys_pretend_to_success',  // SYS_munlockall
    '__sys_unimplemented',       // SYS_sched_setparam
    '__sys_unimplemented',       // SYS_sched_getparam
    '__sys_unimplemented',       // SYS_sched_setscheduler
    '__sys_unimplemented',       // SYS_sched_getscheduler
    '__sys_pretend_to_success',  // SYS_sched_yield
    '__sys_unimplemented',       // SYS_sched_get_priority_max
    '__sys_unimplemented',       // SYS_sched_get_priority_min
    '__sys_unimplemented',       // SYS_sched_rr_get_interval
    '__sys_nanosleep',           // SYS_nanosleep
    '__sys_unimplemented',       // SYS_mremap
    '__sys_unimplemented',       // SYS_setresuid
    '__sys_unimplemented',       // SYS_getresuid
    '__sys_unimplemented',       // SYS_vm86
    '__sys_unimplemented',       // SYS_query_module
    '__sys_poll',                // SYS_poll
    '__sys_unimplemented',       // SYS_nfsservctl
    '__sys_unimplemented',       // SYS_setresgid
    '__sys_unimplemented',       // SYS_getresgid
    '__sys_unimplemented',       // SYS_prctl
    '__sys_unimplemented',       // SYS_rt_sigreturn
    '__sys_unimplemented',       // SYS_rt_sigaction
    '__sys_pretend_to_success',  // SYS_rt_sigprocmask
    '__sys_unimplemented',       // SYS_rt_sigpending
    '__sys_unimplemented',       // SYS_rt_sigtimedwait
    '__sys_unimplemented',       // SYS_rt_sigqueueinfo
    '__sys_unimplemented',       // SYS_rt_sigsuspend
    '__sys_pread',               // SYS_pread64
    '__sys_pwrite',              // SYS_pwrite64
    '__sys_chown',               // SYS_chown
    '__sys_getcwd',              // SYS_getcwd
    '__sys_unimplemented',       // SYS_capget
    '__sys_unimplemented',       // SYS_capset
    '__sys_unimplemented',       // SYS_sigaltstack
    '__sys_unimplemented',       // SYS_sendfile
    '__sys_unimplemented',       // SYS_getpmsg
    '__sys_unimplemented',       // SYS_putpmsg
    '__sys_unimplemented',       // SYS_vfork
    '__sys_unimplemented',       // SYS_ugetrlimit
    '__sys_unimplemented',       // SYS_mmap2
    '__sys_unimplemented',       // SYS_truncate64
    '__sys_unimplemented',       // SYS_ftruncate64
    '__sys_unimplemented',       // SYS_stat64
    '__sys_unimplemented',       // SYS_lstat64
    '__sys_unimplemented',       // SYS_fstat64
    '__sys_unimplemented',       // SYS_lchown32
    '__sys_unimplemented',       // SYS_getuid32
    '__sys_unimplemented',       // SYS_getgid32
    '__sys_unimplemented',       // SYS_geteuid32
    '__sys_unimplemented',       // SYS_getegid32
    '__sys_unimplemented',       // SYS_setreuid32
    '__sys_unimplemented',       // SYS_setregid32
    '__sys_unimplemented',       // SYS_getgroups32
    '__sys_unimplemented',       // SYS_setgroups32
    '__sys_unimplemented',       // SYS_fchown32
    '__sys_unimplemented',       // SYS_setresuid32
    '__sys_unimplemented',       // SYS_getresuid32
    '__sys_unimplemented',       // SYS_setresgid32
    '__sys_unimplemented',       // SYS_getresgid32
    '__sys_unimplemented',       // SYS_chown32
    '__sys_unimplemented',       // SYS_setuid32
    '__sys_unimplemented',       // SYS_setgid32
    '__sys_unimplemented',       // SYS_setfsuid32
    '__sys_unimplemented',       // SYS_setfsgid32
    '__sys_unimplemented',       // SYS_pivot_root
    '__sys_unimplemented',       // SYS_mincore
    '__sys_pretend_to_success',  // SYS_madvise
    '__sys_unimplemented',       // SYS_madvise1
    '__sys_unimplemented',       // SYS_getdents64
    '__sys_unimplemented',       // SYS_fcntl64
    '__sys_unimplemented',
    '__sys_unimplemented',       // SYS_gettid
    '__sys_unimplemented',       // SYS_readahead
    '__sys_unimplemented',       // SYS_setxattr
    '__sys_unimplemented',       // SYS_lsetxattr
    '__sys_unimplemented',       // SYS_fsetxattr
    '__sys_unimplemented',       // SYS_getxattr
    '__sys_unimplemented',       // SYS_lgetxattr
    '__sys_unimplemented',       // SYS_fgetxattr
    '__sys_unimplemented',       // SYS_listxattr
    '__sys_unimplemented',       // SYS_llistxattr
    '__sys_unimplemented',       // SYS_flistxattr
    '__sys_unimplemented',       // SYS_removexattr
    '__sys_unimplemented',       // SYS_lremovexattr
    '__sys_unimplemented',       // SYS_fremovexattr
    '__sys_unimplemented',       // SYS_tkill
    '__sys_unimplemented',       // SYS_sendfile64
    '__sys_pretend_to_success',  // SYS_futex
    '__sys_unimplemented',       // SYS_sched_setaffinity
    '__sys_unimplemented',       // SYS_sched_getaffinity
    '__sys_unimplemented',       // SYS_set_thread_area
    '__sys_unimplemented',       // SYS_get_thread_area
    '__sys_unimplemented',       // SYS_io_setup
    '__sys_unimplemented',       // SYS_io_destroy
    '__sys_unimplemented',       // SYS_io_getevents
    '__sys_unimplemented',       // SYS_io_submit
    '__sys_unimplemented',       // SYS_io_cancel
    '__sys_pretend_to_success',  // SYS_fadvise64
    '__sys_unimplemented',
    '__sys_unimplemented',       // SYS_exit_group
    '__sys_unimplemented',       // SYS_lookup_dcookie
    '__sys_unimplemented',       // SYS_epoll_create
    '__sys_unimplemented',       // SYS_epoll_ctl
    '__sys_unimplemented',       // SYS_epoll_wait
    '__sys_unimplemented',       // SYS_remap_file_pages
    '__sys_unimplemented',       // SYS_set_tid_address
    '__sys_unimplemented',       // SYS_timer_create
    '__sys_unimplemented',       // SYS_timer_settime   (SYS_timer_create+1)
    '__sys_unimplemented',       // SYS_timer_gettime   (SYS_timer_create+2)
    '__sys_unimplemented',       // SYS_timer_getoverrun    (SYS_timer_create+3)
    '__sys_unimplemented',       // SYS_timer_delete    (SYS_timer_create+4)
    '__sys_unimplemented',       // SYS_clock_settime   (SYS_timer_create+5)
    '__sys_unimplemented',       // SYS_clock_gettime   (SYS_timer_create+6)
    '__sys_unimplemented',       // SYS_clock_getres    (SYS_timer_create+7)
    '__sys_unimplemented',       // SYS_clock_nanosleep (SYS_timer_create+8)
    '__sys_unimplemented',       // SYS_statfs64
    '__sys_unimplemented',       // SYS_fstatfs64
    '__sys_unimplemented',       // SYS_tgkill
    '__sys_unimplemented',       // SYS_utimes
    '__sys_pretend_to_success',  // SYS_fadvise64_64
    '__sys_unimplemented',       // SYS_vserver
    '__sys_unimplemented',       // SYS_mbind
    '__sys_unimplemented',       // SYS_get_mempolicy
    '__sys_unimplemented',       // SYS_set_mempolicy
    '__sys_unimplemented',       // SYS_mq_open
    '__sys_unimplemented',       // SYS_mq_unlink       (SYS_mq_open+1)
    '__sys_unimplemented',       // SYS_mq_timedsend    (SYS_mq_open+2)
    '__sys_unimplemented',       // SYS_mq_timedreceive (SYS_mq_open+3)
    '__sys_unimplemented',       // SYS_mq_notify       (SYS_mq_open+4)
    '__sys_unimplemented',       // SYS_mq_getsetattr   (SYS_mq_open+5)
    '__sys_unimplemented',       // SYS_kexec_load
    '__sys_unimplemented',       // SYS_waitid
    '__sys_unimplemented',
    '__sys_unimplemented',       // SYS_add_key
    '__sys_unimplemented',       // SYS_request_key
    '__sys_unimplemented',       // SYS_keyctl
    '__sys_unimplemented',       // SYS_ioprio_set
    '__sys_unimplemented',       // SYS_ioprio_get
    '__sys_unimplemented',       // SYS_inotify_init
    '__sys_unimplemented',       // SYS_inotify_add_watch
    '__sys_unimplemented',       // SYS_inotify_rm_watch
    '__sys_unimplemented',       // SYS_migrate_pages
    '__sys_unimplemented',       // SYS_openat
    '__sys_unimplemented',       // SYS_mkdirat
    '__sys_unimplemented',       // SYS_mknodat
    '__sys_unimplemented',       // SYS_fchownat
    '__sys_unimplemented',       // SYS_futimesat
    '__sys_unimplemented',       // SYS_fstatat64
    '__sys_unimplemented',       // SYS_unlinkat
    '__sys_unimplemented',       // SYS_renameat
    '__sys_unimplemented',       // SYS_linkat
    '__sys_unimplemented',       // SYS_symlinkat
    '__sys_unimplemented',       // SYS_readlinkat
    '__sys_fchmodat',            // SYS_fchmodat
    '__sys_unimplemented',       // SYS_faccessat
    '__sys_unimplemented',       // SYS_pselect6
    '__sys_unimplemented',       // SYS_ppoll
    '__sys_unimplemented',       // SYS_unshare
    '__sys_unimplemented',       // SYS_set_robust_list
    '__sys_unimplemented',       // SYS_get_robust_list
    '__sys_unimplemented',       // SYS_splice
    '__sys_unimplemented',       // SYS_sync_file_range
    '__sys_unimplemented',       // SYS_tee
    '__sys_unimplemented',       // SYS_vmsplice
    '__sys_unimplemented',       // SYS_move_pages
    '__sys_unimplemented',       // SYS_getcpu
    '__sys_unimplemented',       // SYS_epoll_pwait
    '__sys_unimplemented',       // SYS_utimensat
    '__sys_unimplemented',       // SYS_signalfd
    '__sys_unimplemented',       // SYS_timerfd_create
    '__sys_unimplemented',       // SYS_eventfd
    '__sys_unimplemented',       // SYS_fallocate
    '__sys_unimplemented',       // SYS_timerfd_settime
    '__sys_unimplemented',       // SYS_timerfd_gettime
    '__sys_unimplemented',       // SYS_signalfd4
    '__sys_unimplemented',       // SYS_eventfd2
    '__sys_unimplemented',       // SYS_epoll_create1
    '__sys_unimplemented',       // SYS_dup3
    '__sys_unimplemented',       // SYS_pipe2
    '__sys_unimplemented',       // SYS_inotify_init1
    '__sys_unimplemented',       // SYS_preadv
    '__sys_unimplemented',       // SYS_pwritev
    '__sys_unimplemented',
    '__sys_unimplemented',
    '__sys_unimplemented',
    '__sys_unimplemented',
    '__sys_unimplemented',
    '__sys_unimplemented',       // SYS_prlimit64
    '__sys_unimplemented',       // SYS_name_to_handle_at
    '__sys_unimplemented',       // SYS_open_by_handle_at
    '__sys_unimplemented',       // SYS_clock_adjtime
    '__sys_unimplemented',       // SYS_syncfs
    '__sys_unimplemented',       // SYS_sendmmsg
    '__sys_unimplemented',       // SYS_setns
    '__sys_unimplemented',       // SYS_process_vm_readv
    '__sys_unimplemented',       // SYS_process_vm_writev
    '__sys_unimplemented',       // SYS_kcmp
    '__sys_unimplemented',       // SYS_finit_module
  ],
  __syscall0__deps: ['$SYSCALL_TABLE'],
  __syscall0: function(n) {
    return SYSCALL_TABLE[n]();
  },
  __syscall1__deps: ['$SYSCALL_TABLE'],
  __syscall1: function(n, a1) {
    return SYSCALL_TABLE[n](a1);
  },
  __syscall2__deps: ['$SYSCALL_TABLE'],
  __syscall2: function(n, a1, a2) {
    return SYSCALL_TABLE[n](a1, a2);
  },
  __syscall3__deps: ['$SYSCALL_TABLE'],
  __syscall3: function(n, a1, a2, a3) {
    return SYSCALL_TABLE[n](a1, a2, a3);
  },
  __syscall4__deps: ['$SYSCALL_TABLE'],
  __syscall4: function(n, a1, a2, a3, a4) {
    return SYSCALL_TABLE[n](a1, a2, a3, a4);
  },
  __syscall5__deps: ['$SYSCALL_TABLE'],
  __syscall5: function(n, a1, a2, a3, a4, a5) {
    return SYSCALL_TABLE[n](a1, a2, a3, a4, a5);
  },
  __syscall6__deps: ['$SYSCALL_TABLE'],
  __syscall6: function(n, a1, a2, a3, a4, a5, a6) {
    return SYSCALL_TABLE[n](a1, a2, a3, a4, a5, a6);
  },

  // ==========================================================================
  // emscripten.h
  // ==========================================================================

  emscripten_run_script: function(ptr) {
    eval(Pointer_stringify(ptr));
  },

  emscripten_run_script_int: function(ptr) {
    return eval(Pointer_stringify(ptr))|0;
  },

  emscripten_run_script_string: function(ptr) {
    var s = eval(Pointer_stringify(ptr));
    var me = _emscripten_run_script_string;
    if (!me.bufferSize || me.bufferSize < s.length+1) {
      if (me.bufferSize) _free(me.buffer);
      me.bufferSize = s.length+1;
      me.buffer = _malloc(me.bufferSize);
    }
    writeStringToMemory(s, me.buffer);
    return me.buffer;
  },

  emscripten_random: function() {
    return Math.random();
  },

  emscripten_jcache_printf___deps: ['_formatString'],
  emscripten_jcache_printf_: function(varargs) {
    var MAX = 10240;
    if (!_emscripten_jcache_printf_.buffer) {
      _emscripten_jcache_printf_.buffer = _malloc(MAX);
    }
    var i = 0;
    do {
      var curr = {{{ makeGetValue('varargs', '0', 'i8') }}};
      varargs += {{{ STACK_ALIGN }}};
      {{{ makeSetValue('_emscripten_jcache_printf_.buffer', 'i', 'curr', 'i8') }}};
      i++;
      assert(i*{{{ STACK_ALIGN }}} < MAX);
    } while (curr != 0);
    Module.print(intArrayToString(__formatString(_emscripten_jcache_printf_.buffer, varargs)).replace('\\n', ''));
    Runtime.stackAlloc(-4*i); // free up the stack space we know is ok to free
  },

  //============================
  // i64 math
  //============================

  i64Add__asm: true,
  i64Add__sig: 'iiiii',
  i64Add: function(a, b, c, d) {
    /*
      x = a + b*2^32
      y = c + d*2^32
      result = l + h*2^32
    */
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0;
    l = (a + c)>>>0;
    h = (b + d + (((l>>>0) < (a>>>0))|0))>>>0; // Add carry from low word to high word on overflow.
    {{{ makeStructuralReturn(['l|0', 'h'], true) }}};
  },
  llvm_uadd_with_overflow_i64__asm: true,
  llvm_uadd_with_overflow_i64__sig: 'iiiii',
  llvm_uadd_with_overflow_i64: function(a, b, c, d) {
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0, overflow = 0;
    l = (a + c)>>>0;
    h = (b + d)>>>0;
    overflow = ((h>>>0) < (b>>>0))|0; // Return whether addition overflowed even the high word.
    if ((l>>>0) < (a>>>0)) {
      h = (h + 1)>>>0; // Add carry from low word to high word on overflow.
      overflow = overflow | (!h); // Check again for overflow.
    }
    {{{ makeStructuralReturn(['l|0', 'h', 'overflow'], true) }}};
  },

  i64Subtract__asm: true,
  i64Subtract__sig: 'iiiii',
  i64Subtract: function(a, b, c, d) {
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0;
    l = (a - c)>>>0;
    h = (b - d)>>>0;
    h = (b - d - (((c>>>0) > (a>>>0))|0))>>>0; // Borrow one from high word to low word on underflow.
    {{{ makeStructuralReturn(['l|0', 'h'], true) }}};
  },

  bitshift64Shl__asm: true,
  bitshift64Shl__sig: 'iiii',
  bitshift64Shl: function(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      tempRet0 = (high << bits) | ((low&(ander << (32 - bits))) >>> (32 - bits));
      return low << bits;
    }
    tempRet0 = low << (bits - 32);
    return 0;
  },
  bitshift64Ashr__asm: true,
  bitshift64Ashr__sig: 'iiii',
  bitshift64Ashr: function(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      tempRet0 = high >> bits;
      return (low >>> bits) | ((high&ander) << (32 - bits));
    }
    tempRet0 = (high|0) < 0 ? -1 : 0;
    return (high >> (bits - 32))|0;
  },
  bitshift64Lshr__asm: true,
  bitshift64Lshr__sig: 'iiii',
  bitshift64Lshr: function(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      tempRet0 = high >>> bits;
      return (low >>> bits) | ((high&ander) << (32 - bits));
    }
    tempRet0 = 0;
    return (high >>> (bits - 32))|0;
  },
};

function autoAddDeps(object, name) {
  name = [name];
  for (var item in object) {
    if (item.substr(-6) != '__deps' && !object[item + '__deps']) {
      object[item + '__deps'] = name;
    }
  }
}

// Add aborting stubs for various libc stuff needed by libc++
['pthread_cond_signal', 'pthread_equal', 'wcstol', 'wcstoll', 'wcstoul', 'wcstoull', 'wcstof', 'wcstod', 'wcstold', 'swprintf', 'pthread_join', 'pthread_detach', 'strcoll_l', 'strxfrm_l', 'wcscoll_l', 'toupper_l', 'tolower_l', 'iswspace_l', 'iswprint_l', 'iswcntrl_l', 'iswupper_l', 'iswlower_l', 'iswalpha_l', 'iswdigit_l', 'iswpunct_l', 'iswxdigit_l', 'iswblank_l', 'wcsxfrm_l', 'towupper_l', 'towlower_l'].forEach(function(aborter) {
  LibraryManager.library[aborter] = function() { throw 'TODO: ' + aborter };
});

