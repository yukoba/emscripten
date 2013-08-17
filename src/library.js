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
  stdin: 'allocate(1, "i32*", ALLOC_STATIC)',
//  stdout: 'allocate(1, "i32*", ALLOC_STATIC)',
  stderr: 'allocate(1, "i32*", ALLOC_STATIC)',
  _impure_ptr: 'allocate(1, "i32*", ALLOC_STATIC)',

  // ==========================================================================
  // dirent.h
  // ==========================================================================

  __dirent_struct_layout: Runtime.generateStructInfo([
    ['i32', 'd_ino'],
    ['b1024', 'd_name'],
    ['i32', 'd_off'],
    ['i32', 'd_reclen'],
    ['i32', 'd_type']]),
  opendir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__dirent_struct_layout', 'open'],
  opendir: function(dirname) {
    // DIR *opendir(const char *dirname);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/opendir.html
    // NOTE: Calculating absolute path redundantly since we need to associate it
    //       with the opened stream.
    var path = Pointer_stringify(dirname);
    if (!path) {
      ___setErrNo(ERRNO_CODES.ENOENT);
      return 0;
    }
    var node;
    try {
      var lookup = FS.lookupPath(path, { follow: true });
      node = lookup.node;
    } catch (e) {
      FS.handleFSError(e);
      return 0;
    }
    if (!FS.isDir(node.mode)) {
      ___setErrNo(ERRNO_CODES.ENOTDIR);
      return 0;
    }
    var err = _open(dirname, {{{ cDefine('O_RDONLY') }}}, allocate([0, 0, 0, 0], 'i32', ALLOC_STACK));
    // open returns 0 on failure, not -1
    return err === -1 ? 0 : err;
  },
  closedir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'close'],
  closedir: function(dirp) {
    // int closedir(DIR *dirp);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/closedir.html
    return _close(dirp);
  },
  telldir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  telldir: function(dirp) {
    // long int telldir(DIR *dirp);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/telldir.html
    var stream = FS.getStream(dirp);
    if (!stream || !FS.isDir(stream.node.mode)) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    return stream.position;
  },
  seekdir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'lseek'],
  seekdir: function(dirp, loc) {
    // void seekdir(DIR *dirp, long int loc);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/seekdir.html
    _lseek(dirp, loc, {{{ cDefine('SEEK_SET') }}});
  },
  rewinddir__deps: ['seekdir'],
  rewinddir: function(dirp) {
    // void rewinddir(DIR *dirp);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/rewinddir.html
    _seekdir(dirp, 0);
  },
  readdir_r__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__dirent_struct_layout'],
  readdir_r: function(dirp, entry, result) {
    // int readdir_r(DIR *dirp, struct dirent *entry, struct dirent **result);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/readdir_r.html
    var stream = FS.getStream(dirp);
    if (!stream) {
      return ___setErrNo(ERRNO_CODES.EBADF);
    }
    var entries;
    try {
      entries = FS.readdir(stream.path);
    } catch (e) {
      return FS.handleFSError(e);
    }
    if (stream.position < 0 || stream.position >= entries.length) {
      {{{ makeSetValue('result', '0', '0', 'i8*') }}}
      return 0;
    }
    var id;
    var type;
    var name = entries[stream.position];
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
    {{{ makeSetValue('entry', '___dirent_struct_layout.d_ino', 'id', 'i32') }}}
    {{{ makeSetValue('entry', '___dirent_struct_layout.d_off', 'offset', 'i32') }}}
    {{{ makeSetValue('entry', '___dirent_struct_layout.d_reclen', 'name.length + 1', 'i32') }}}
    for (var i = 0; i < name.length; i++) {
      {{{ makeSetValue('entry + ___dirent_struct_layout.d_name', 'i', 'name.charCodeAt(i)', 'i8') }}}
    }
    {{{ makeSetValue('entry + ___dirent_struct_layout.d_name', 'i', '0', 'i8') }}}
    {{{ makeSetValue('entry', '___dirent_struct_layout.d_type', 'type', 'i8') }}}
    {{{ makeSetValue('result', '0', 'entry', 'i8*') }}}
    stream.position++;
    return 0;
  },
  readdir__deps: ['readdir_r', '__setErrNo', '$ERRNO_CODES'],
  readdir: function(dirp) {
    // struct dirent *readdir(DIR *dirp);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/readdir_r.html
    var stream = FS.getStream(dirp);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return 0;
    }
    // TODO Is it supposed to be safe to execute multiple readdirs?
    if (!_readdir.entry) _readdir.entry = _malloc(___dirent_struct_layout.__size__);
    if (!_readdir.result) _readdir.result = _malloc(4);
    var err = _readdir_r(dirp, _readdir.entry, _readdir.result);
    if (err) {
      ___setErrNo(err);
      return 0;
    }
    return {{{ makeGetValue(0, '_readdir.result', 'i8*') }}};
  },
  __01readdir64_: 'readdir',
  // TODO: Check if we need to link any other aliases.

  // ==========================================================================
  // utime.h
  // ==========================================================================

  __utimbuf_struct_layout: Runtime.generateStructInfo([
    ['i32', 'actime'],
    ['i32', 'modtime']]),
  utime__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__utimbuf_struct_layout'],
  utime: function(path, times) {
    // int utime(const char *path, const struct utimbuf *times);
    // http://pubs.opengroup.org/onlinepubs/009695399/basedefs/utime.h.html
    var time;
    if (times) {
      // NOTE: We don't keep track of access timestamps.
      var offset = ___utimbuf_struct_layout.modtime;
      time = {{{ makeGetValue('times', 'offset', 'i32') }}}
      time *= 1000;
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

  utimes: function() { throw 'utimes not implemented' },

  // ==========================================================================
  // libgen.h
  // ==========================================================================

  __libgenSplitName: function(path) {
    if (path === 0 || {{{ makeGetValue('path', 0, 'i8') }}} === 0) {
      // Null or empty results in '.'.
      var me = ___libgenSplitName;
      if (!me.ret) {
        me.ret = allocate([{{{ charCode('.') }}}, 0], 'i8', ALLOC_NORMAL);
      }
      return [me.ret, -1];
    } else {
      var slash = {{{ charCode('/') }}};
      var allSlashes = true;
      var slashPositions = [];
      for (var i = 0; {{{ makeGetValue('path', 'i', 'i8') }}} !== 0; i++) {
        if ({{{ makeGetValue('path', 'i', 'i8') }}} === slash) {
          slashPositions.push(i);
        } else {
          allSlashes = false;
        }
      }
      var length = i;
      if (allSlashes) {
        // All slashes result in a single slash.
        {{{ makeSetValue('path', '1', '0', 'i8') }}}
        return [path, -1];
      } else {
        // Strip trailing slashes.
        while (slashPositions.length &&
               slashPositions[slashPositions.length - 1] == length - 1) {
          {{{ makeSetValue('path', 'slashPositions.pop(i)', '0', 'i8') }}}
          length--;
        }
        return [path, slashPositions.pop()];
      }
    }
  },
  basename__deps: ['__libgenSplitName'],
  basename: function(path) {
    // char *basename(char *path);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/basename.html
    var result = ___libgenSplitName(path);
    return result[0] + result[1] + 1;
  },
  __xpg_basename: 'basename',
  dirname__deps: ['__libgenSplitName'],
  dirname: function(path) {
    // char *dirname(char *path);
    // http://pubs.opengroup.org/onlinepubs/007908799/xsh/dirname.html
    var result = ___libgenSplitName(path);
    if (result[1] == 0) {
      {{{ makeSetValue('result[0]', 1, '0', 'i8') }}}
    } else if (result[1] !== -1) {
      {{{ makeSetValue('result[0]', 'result[1]', '0', 'i8') }}}
    }
    return result[0];
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
  stat__deps: ['$FS', '__stat_struct_layout'],
  stat: function(path, buf, dontResolveLastLink) {
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
  lstat__deps: ['stat'],
  lstat: function(path, buf) {
    // int lstat(const char *path, struct stat *buf);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/lstat.html
    return _stat(path, buf, true);
  },
  fstat__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'stat'],
  fstat: function(fildes, buf) {
    // int fstat(int fildes, struct stat *buf);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/fstat.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    return _stat(stream.path, buf);
  },
  mknod__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  mknod: function(path, mode, dev) {
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
  mkdir__deps: ['mknod'],
  mkdir: function(path, mode) {
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
  mkfifo__deps: ['__setErrNo', '$ERRNO_CODES'],
  mkfifo: function(path, mode) {
    // int mkfifo(const char *path, mode_t mode);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/mkfifo.html
    // NOTE: We support running only a single process, and named pipes require
    //       blocking, which we can't provide. The error code is not very
    //       accurate, but it's the closest among those allowed in the standard
    //       and unlikely to result in retries.
    ___setErrNo(ERRNO_CODES.EROFS);
    return -1;
  },
  chmod__deps: ['$FS', '__setErrNo'],
  chmod: function(path, mode, dontResolveLastLink) {
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
  fchmod__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'chmod'],
  fchmod: function(fildes, mode) {
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
  lchmod__deps: ['chmod'],
  lchmod: function(path, mode) {
    path = Pointer_stringify(path);
    try {
      FS.lchmod(path, mode);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },

  umask__deps: ['$FS'],
  umask: function(newMask) {
    // mode_t umask(mode_t cmask);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/umask.html
    // NOTE: This value isn't actually used for anything.
    if (_umask.cmask === undefined) _umask.cmask = 0x1FF;  // S_IRWXU | S_IRWXG | S_IRWXO.
    var oldMask = _umask.cmask;
    _umask.cmask = newMask;
    return oldMask;
  },
  stat64: 'stat',
  fstat64: 'fstat',
  lstat64: 'lstat',
  __01fstat64_: 'fstat',
  __01stat64_: 'stat',
  __01lstat64_: 'lstat',

  // TODO: Check if other aliases are needed.

  // ==========================================================================
  // sys/statvfs.h
  // ==========================================================================

  __statvfs_struct_layout: Runtime.generateStructInfo([
    ['i32', 'f_bsize'],
    ['i32', 'f_frsize'],
    ['i32', 'f_blocks'],
    ['i32', 'f_bfree'],
    ['i32', 'f_bavail'],
    ['i32', 'f_files'],
    ['i32', 'f_ffree'],
    ['i32', 'f_favail'],
    ['i32', 'f_fsid'],
    ['i32', 'f_flag'],
    ['i32', 'f_namemax']]),
  statvfs__deps: ['$FS', '__statvfs_struct_layout'],
  statvfs: function(path, buf) {
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/statvfs.html
    // int statvfs(const char *restrict path, struct statvfs *restrict buf);
    var offsets = ___statvfs_struct_layout;
    // NOTE: None of the constants here are true. We're just returning safe and
    //       sane values.
    {{{ makeSetValue('buf', 'offsets.f_bsize', '4096', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_frsize', '4096', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_blocks', '1000000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_bfree', '500000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_bavail', '500000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_files', 'FS.nextInode', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_ffree', '1000000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_favail', '1000000', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_fsid', '42', 'i32') }}}
    {{{ makeSetValue('buf', 'offsets.f_flag', '2', 'i32') }}}  // ST_NOSUID
    {{{ makeSetValue('buf', 'offsets.f_namemax', '255', 'i32') }}}
    return 0;
  },
  fstatvfs__deps: ['statvfs'],
  fstatvfs: function(fildes, buf) {
    // int fstatvfs(int fildes, struct statvfs *buf);
    // http://pubs.opengroup.org/onlinepubs/009604499/functions/statvfs.html
    return _statvfs(0, buf);
  },
  __01statvfs64_: 'statvfs',
  __01fstatvfs64_: 'fstatvfs',

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
  open__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__dirent_struct_layout'],
  open: function(path, oflag, varargs) {
    // int open(const char *path, int oflag, ...);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/open.html
    var mode = {{{ makeGetValue('varargs', 0, 'i32') }}};
    path = Pointer_stringify(path);
    try {
      var stream = FS.open(path, oflag, mode);
      return stream.fd;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  creat__deps: ['open'],
  creat: function(path, mode) {
    // int creat(const char *path, mode_t mode);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/creat.html
    return _open(path, {{{ cDefine('O_WRONLY') }}} | {{{ cDefine('O_CREAT') }}} | {{{ cDefine('O_TRUNC') }}}, allocate([mode, 0, 0, 0], 'i32', ALLOC_STACK));
  },
  mkstemp__deps: ['creat'],
  mkstemp: function(template) {
    if (!_mkstemp.counter) _mkstemp.counter = 0;
    var c = (_mkstemp.counter++).toString();
    var rep = 'XXXXXX';
    while (c.length < rep.length) c = '0' + c;
    writeArrayToMemory(intArrayFromString(c), template + Pointer_stringify(template).indexOf(rep));
    return _creat(template, 0600);
  },
  fcntl__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', '__flock_struct_layout'],
  fcntl: function(fildes, cmd, varargs, dup2) {
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
  posix_fadvise: function(fd, offset, len, advice) {
    // int posix_fadvise(int fd, off_t offset, off_t len, int advice);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/posix_fadvise.html
    // Advise as much as you wish. We don't care.
    return 0;
  },
  posix_madvise: 'posix_fadvise',
  posix_fallocate__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  posix_fallocate: function(fd, offset, len) {
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
  // sys/file.h
  // ==========================================================================

  flock: function(fd, operation) {
    // int flock(int fd, int operation);
    // Pretend to succeed
    return 0;
  },

  // ==========================================================================
  // poll.h
  // ==========================================================================

  __pollfd_struct_layout: Runtime.generateStructInfo([
    ['i32', 'fd'],
    ['i16', 'events'],
    ['i16', 'revents']]),
  poll__deps: ['$FS', '__pollfd_struct_layout'],
  poll: function(fds, nfds, timeout) {
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

  access__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  access: function(path, amode) {
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
  chdir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  chdir: function(path) {
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
  chown__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  chown: function(path, owner, group, dontResolveLastLink) {
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
  chroot__deps: ['__setErrNo', '$ERRNO_CODES'],
  chroot: function(path) {
    // int chroot(const char *path);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/chroot.html
    ___setErrNo(ERRNO_CODES.EACCES);
    return -1;
  },
  close__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  close: function(fildes) {
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
  dup__deps: ['fcntl'],
  dup: function(fildes) {
    // int dup(int fildes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/dup.html
    return _fcntl(fildes, 0, allocate([0, 0, 0, 0], 'i32', ALLOC_STACK));  // F_DUPFD.
  },
  dup2__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'fcntl', 'close'],
  dup2: function(fildes, fildes2) {
    // int dup2(int fildes, int fildes2);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/dup.html
    var stream = FS.getStream(fildes);
    if (fildes2 < 0) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    } else if (fildes === fildes2 && stream) {
      return fildes;
    } else {
      _close(fildes2);
      try {
        var stream2 = FS.open(stream.path, stream.flags, 0, fildes2, fildes2);
        return stream2.fd;
      } catch (e) {
        FS.handleFSError(e);
        return -1;
      }
    }
  },
  fchown__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'chown'],
  fchown: function(fildes, owner, group) {
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
  fchdir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'chdir'],
  fchdir: function(fildes) {
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
  ctermid__deps: ['strcpy'],
  ctermid: function(s) {
    // char *ctermid(char *s);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/ctermid.html
    if (!_ctermid.ret) {
      var arr = intArrayFromString('/dev/tty');
      _ctermid.ret = allocate(arr, 'i8', ALLOC_NORMAL);
    }
    return s ? _strcpy(s, _ctermid.ret) : _ctermid.ret;
  },
  crypt: function(key, salt) {
    // char *(const char *, const char *);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/crypt.html
    // TODO: Implement (probably compile from C).
    ___setErrNo(ERRNO_CODES.ENOSYS);
    return 0;
  },
  encrypt: function(block, edflag) {
    // void encrypt(char block[64], int edflag);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/encrypt.html
    // TODO: Implement (probably compile from C).
    ___setErrNo(ERRNO_CODES.ENOSYS);
  },
  fpathconf__deps: ['__setErrNo', '$ERRNO_CODES'],
  fpathconf: function(fildes, name) {
    // long fpathconf(int fildes, int name);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/encrypt.html
    // NOTE: The first parameter is ignored, so pathconf == fpathconf.
    // The constants here aren't real values. Just mimicking glibc.
    switch (name) {
      case {{{ cDefine('_PC_LINK_MAX') }}}:
        return 32000;
      case {{{ cDefine('_PC_MAX_CANON') }}}:
      case {{{ cDefine('_PC_MAX_INPUT') }}}:
      case {{{ cDefine('_PC_NAME_MAX') }}}:
        return 255;
      case {{{ cDefine('_PC_PATH_MAX') }}}:
      case {{{ cDefine('_PC_PIPE_BUF') }}}:
      case {{{ cDefine('_PC_REC_MIN_XFER_SIZE') }}}:
      case {{{ cDefine('_PC_REC_XFER_ALIGN') }}}:
      case {{{ cDefine('_PC_ALLOC_SIZE_MIN') }}}:
        return 4096;
      case {{{ cDefine('_PC_CHOWN_RESTRICTED') }}}:
      case {{{ cDefine('_PC_NO_TRUNC') }}}:
      case {{{ cDefine('_PC_2_SYMLINKS') }}}:
        return 1;
      case {{{ cDefine('_PC_VDISABLE') }}}:
        return 0;
      case {{{ cDefine('_PC_SYNC_IO') }}}:
      case {{{ cDefine('_PC_ASYNC_IO') }}}:
      case {{{ cDefine('_PC_PRIO_IO') }}}:
      case {{{ cDefine('_PC_SOCK_MAXBUF') }}}:
      case {{{ cDefine('_PC_REC_INCR_XFER_SIZE') }}}:
      case {{{ cDefine('_PC_REC_MAX_XFER_SIZE') }}}:
      case {{{ cDefine('_PC_SYMLINK_MAX') }}}:
        return -1;
      case {{{ cDefine('_PC_FILESIZEBITS') }}}:
        return 64;
    }
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  },
  pathconf: 'fpathconf',
  fsync__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  fsync: function(fildes) {
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
  fdatasync: 'fsync',
  truncate__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  truncate: function(path, length) {
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
  ftruncate__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'truncate'],
  ftruncate: function(fildes, length) {
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
  getcwd__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  getcwd: function(buf, size) {
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
  getwd__deps: ['getcwd'],
  getwd: function(path_name) {
    // char *getwd(char *path_name);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getwd.html
    return _getcwd(path_name, 4096);  // PATH_MAX.
  },
  isatty__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  isatty: function(fildes) {
    // int isatty(int fildes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/isatty.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return 0;
    }
    // HACK - implement tcgetattr
    if (!stream.tty) {
      ___setErrNo(ERRNO_CODES.ENOTTY);
      return 0;
    }
    return 1;
  },
  lchown__deps: ['chown'],
  lchown: function(path, owner, group) {
    // int lchown(const char *path, uid_t owner, gid_t group);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/lchown.html
    return _chown(path, owner, group, true);
  },
  link__deps: ['__setErrNo', '$ERRNO_CODES'],
  link: function(path1, path2) {
    // int link(const char *path1, const char *path2);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/link.html
    // We don't support hard links.
    ___setErrNo(ERRNO_CODES.EMLINK);
    return -1;
  },
  lockf__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  lockf: function(fildes, func, size) {
    // int lockf(int fildes, int function, off_t size);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/lockf.html
    var stream = FS.getStream(fildes);
    if (stream) {
      // Pretend whatever locking or unlocking operation succeeded. Locking does
      // not make much sense, since we have a single process/thread.
      return 0;
    } else {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
  },
  lseek__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  lseek: function(fildes, offset, whence) {
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
  pipe__deps: ['__setErrNo', '$ERRNO_CODES'],
  pipe: function(fildes) {
    // int pipe(int fildes[2]);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/pipe.html
    // It is possible to implement this using two device streams, but pipes make
    // little sense in a single-threaded environment, so we do not support them.
    ___setErrNo(ERRNO_CODES.ENOSYS);
    return -1;
  },
  pread__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  pread: function(fildes, buf, nbyte, offset) {
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
  read__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'recv', 'pread'],
  read: function(fildes, buf, nbyte) {
    // ssize_t read(int fildes, void *buf, size_t nbyte);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/read.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    if (stream && ('socket' in stream)) {
      return _recv(fildes, buf, nbyte, 0);
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
  sync: function() {
    // void sync(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/sync.html
    // All our writing is already synchronized. This is a no-op.
  },
  rmdir__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  rmdir: function(path) {
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
  unlink__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  unlink: function(path) {
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
  ttyname__deps: ['ttyname_r'],
  ttyname: function(fildes) {
    // char *ttyname(int fildes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/ttyname.html
    if (!_ttyname.ret) _ttyname.ret = _malloc(256);
    return _ttyname_r(fildes, _ttyname.ret, 256) ? 0 : _ttyname.ret;
  },
  ttyname_r__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'isatty'],
  ttyname_r: function(fildes, name, namesize) {
    // int ttyname_r(int fildes, char *name, size_t namesize);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/ttyname.html
    var stream = FS.getStream(fildes);
    var ttyname = '/dev/tty';
    if (!stream) {
      return ___setErrNo(ERRNO_CODES.EBADF);
    } else if (!_isatty(fildes)) {
       return ___setErrNo(ERRNO_CODES.ENOTTY);
    } else if (namesize < ttyname.length + 1) {
      return ___setErrNo(ERRNO_CODES.ERANGE);
    }
    writeStringToMemory(ttyname, name);
    return 0;
  },
  symlink__deps: ['$FS', '$PATH', '__setErrNo', '$ERRNO_CODES'],
  symlink: function(path1, path2) {
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
  readlink__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  readlink: function(path, buf, bufsize) {
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
  pwrite__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  pwrite: function(fildes, buf, nbyte, offset) {
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
  write__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'send', 'pwrite'],
  write: function(fildes, buf, nbyte) {
    // ssize_t write(int fildes, const void *buf, size_t nbyte);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/write.html
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    if (stream && ('socket' in stream)) {
      return _send(fildes, buf, nbyte, 0);
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
  alarm: function(seconds) {
    // unsigned alarm(unsigned seconds);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/alarm.html
    // We don't support signals, and there's no way to indicate failure, so just
    // fail silently.
    return 0;
  },
  ualarm: 'alarm',
  confstr__deps: ['__setErrNo', '$ERRNO_CODES', '$ENV'],
  confstr: function(name, buf, len) {
    // size_t confstr(int name, char *buf, size_t len);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/confstr.html
    var value;
    switch (name) {
      case {{{ cDefine('_CS_PATH') }}}:
        value = ENV['PATH'] || '/';
        break;
      case {{{ cDefine('_CS_POSIX_V6_WIDTH_RESTRICTED_ENVS') }}}:
        // Mimicking glibc.
        value = 'POSIX_V6_ILP32_OFF32\nPOSIX_V6_ILP32_OFFBIG';
        break;
      case {{{ cDefine('_CS_GNU_LIBC_VERSION') }}}:
        // This JS implementation was tested against this glibc version.
        value = 'glibc 2.14';
        break;
      case {{{ cDefine('_CS_GNU_LIBPTHREAD_VERSION') }}}:
        // We don't support pthreads.
        value = '';
        break;
      case {{{ cDefine('_CS_POSIX_V6_ILP32_OFF32_LIBS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_ILP32_OFFBIG_LIBS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_LP64_OFF64_CFLAGS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_LP64_OFF64_LDFLAGS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_LP64_OFF64_LIBS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_LPBIG_OFFBIG_CFLAGS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_LPBIG_OFFBIG_LDFLAGS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_LPBIG_OFFBIG_LIBS') }}}:
        value = '';
        break;
      case {{{ cDefine('_CS_POSIX_V6_ILP32_OFF32_CFLAGS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_ILP32_OFF32_LDFLAGS') }}}:
      case {{{ cDefine('_CS_POSIX_V6_ILP32_OFFBIG_LDFLAGS') }}}:
        value = '-m32';
        break;
      case {{{ cDefine('_CS_POSIX_V6_ILP32_OFFBIG_CFLAGS') }}}:
        value = '-m32 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64';
        break;
      default:
        ___setErrNo(ERRNO_CODES.EINVAL);
        return 0;
    }
    if (len == 0 || buf == 0) {
      return value.length + 1;
    } else {
      var length = Math.min(len, value.length);
      for (var i = 0; i < length; i++) {
        {{{ makeSetValue('buf', 'i', 'value.charCodeAt(i)', 'i8') }}}
      }
      if (len > length) {{{ makeSetValue('buf', 'i++', '0', 'i8') }}}
      return i;
    }
  },
  execl__deps: ['__setErrNo', '$ERRNO_CODES'],
  execl: function(/* ... */) {
    // int execl(const char *path, const char *arg0, ... /*, (char *)0 */);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/exec.html
    // We don't support executing external code.
    ___setErrNo(ERRNO_CODES.ENOEXEC);
    return -1;
  },
  execle: 'execl',
  execlp: 'execl',
  execv: 'execl',
  execve: 'execl',
  execvp: 'execl',
  _exit: function(status) {
    // void _exit(int status);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/exit.html
    Module.print('exit(' + status + ') called');
    Module['exit'](status);
  },
  fork__deps: ['__setErrNo', '$ERRNO_CODES'],
  fork: function() {
    // pid_t fork(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fork.html
    // We don't support multiple processes.
    ___setErrNo(ERRNO_CODES.EAGAIN);
    return -1;
  },
  vfork: 'fork',
  getgid: function() {
    // gid_t getgid(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getgid.html
    // We have just one process/group/user, all with ID 0.
    return 0;
  },
  getegid: 'getgid',
  getuid: 'getgid',
  geteuid: 'getgid',
  getpgrp: 'getgid',
  getpid: 'getgid',
  getppid: 'getgid',
  getresuid: function(ruid, euid, suid) {
    // int getresuid(uid_t *ruid, uid_t *euid, uid_t *suid);
    // http://linux.die.net/man/2/getresuid
    // We have just one process/group/user, all with ID 0.
    {{{ makeSetValue('ruid', '0', '0', 'i32') }}}
    {{{ makeSetValue('euid', '0', '0', 'i32') }}}
    {{{ makeSetValue('suid', '0', '0', 'i32') }}}
    return 0;
  },
  getresgid: 'getresuid',
  getgroups__deps: ['__setErrNo', '$ERRNO_CODES'],
  getgroups: function(gidsetsize, grouplist) {
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
  // TODO: Implement initgroups (grp.h).
  setgroups__deps: ['__setErrNo', '$ERRNO_CODES', 'sysconf'],
  setgroups: function(ngroups, gidset) {
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
  gethostid: function() {
    // long gethostid(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/gethostid.html
    return 42;
  },
  gethostname__deps: ['__setErrNo', '$ERRNO_CODES'],
  gethostname: function(name, namelen) {
    // int gethostname(char *name, size_t namelen);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/gethostname.html
    var host = 'emscripten';
    if (typeof window !== 'undefined' && window.location.host) {
      host = window.location.host;
    }
    var length = Math.min(namelen, host.length);
    for (var i = 0; i < length; i++) {
      {{{ makeSetValue('name', 'i', 'host.charCodeAt(i)', 'i8') }}}
    }
    if (namelen > length) {
      {{{ makeSetValue('name', 'i', '0', 'i8') }}}
      return 0;
    } else {
      ___setErrNo(ERRNO_CODES.ENAMETOOLONG);
      return -1;
    }
  },
  getlogin__deps: ['getlogin_r'],
  getlogin: function() {
    // char *getlogin(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getlogin.html
    if (!_getlogin.ret) _getlogin.ret = _malloc(8);
    return _getlogin_r(_getlogin.ret, 8) ? 0 : _getlogin.ret;
  },
  getlogin_r__deps: ['__setErrNo', '$ERRNO_CODES'],
  getlogin_r: function(name, namesize) {
    // int getlogin_r(char *name, size_t namesize);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getlogin.html
    var ret = 'root';
    if (namesize < ret.length + 1) {
      return ___setErrNo(ERRNO_CODES.ERANGE);
    } else {
      for (var i = 0; i < ret.length; i++) {
        {{{ makeSetValue('name', 'i', 'ret.charCodeAt(i)', 'i8') }}}
      }
      {{{ makeSetValue('name', 'i', '0', 'i8') }}}
      return 0;
    }
  },
  getpagesize: function() {
    // int getpagesize(void);
    return PAGE_SIZE;
  },
  getopt: function(argc, argv, optstring) {
    // int getopt(int argc, char * const argv[], const char *optstring);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getopt.html
    // TODO: Implement (probably compile from C).
    return -1;
  },
  getpgid: function(pid) {
    // pid_t getpgid(pid_t pid);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getpgid.html
    // There can only be one process, and its group ID is 0.
    return 0;
  },
  getsid: 'getpgid',
  nice__deps: ['__setErrNo', '$ERRNO_CODES'],
  nice: function(incr) {
    // int nice(int incr);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/nice.html
    // Niceness makes no sense in a single-process environment.
    ___setErrNo(ERRNO_CODES.EPERM);
    return 0;
  },
  pause__deps: ['__setErrNo', '$ERRNO_CODES'],
  pause: function() {
    // int pause(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/pause.html
    // We don't support signals, so we return immediately.
    ___setErrNo(ERRNO_CODES.EINTR);
    return -1;
  },
  setgid__deps: ['__setErrNo', '$ERRNO_CODES'],
  setgid: function(gid) {
    // int setgid(gid_t gid);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/setgid.html
    // We have just one process/group/user, so it makes no sense to set IDs.
    ___setErrNo(ERRNO_CODES.EPERM);
    return -1;
  },
  setegid: 'setgid',
  setuid: 'setgid',
  seteuid: 'setgid',
  setsid: 'setgid',
  setpgrp: 'setgid',
  setpgid__deps: ['__setErrNo', '$ERRNO_CODES'],
  setpgid: function(pid, pgid) {
    // int setpgid(pid_t pid, pid_t pgid);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getpgid.html
    // We have just one process/group/user, so it makes no sense to set IDs.
    ___setErrNo(ERRNO_CODES.EPERM);
    return -1;
  },
  setregid: 'setpgid',
  setreuid: 'setpgid',
  // NOTE: These do not match the signatures, but they all use the same stub.
  setresuid: 'setpgid',
  setresgid: 'setpgid',
  sleep__deps: ['usleep'],
  sleep: function(seconds) {
    // unsigned sleep(unsigned seconds);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/sleep.html
    return _usleep(seconds * 1e6);
  },
  usleep: function(useconds) {
    // int usleep(useconds_t useconds);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/usleep.html
    // We're single-threaded, so use a busy loop. Super-ugly.
    var msec = useconds / 1000;
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
  swab: function(src, dest, nbytes) {
    // void swab(const void *restrict src, void *restrict dest, ssize_t nbytes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/swab.html
    if (nbytes < 0) return;
    nbytes -= nbytes % 2;
    for (var i = 0; i < nbytes; i += 2) {
      var first = {{{ makeGetValue('src', 'i', 'i8') }}};
      var second = {{{ makeGetValue('src', 'i + 1', 'i8') }}};
      {{{ makeSetValue('dest', 'i', 'second', 'i8') }}}
      {{{ makeSetValue('dest', 'i + 1', 'first', 'i8') }}}
    }
  },
  tcgetpgrp: function(fildes) {
    // pid_t tcgetpgrp(int fildes);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/tcgetpgrp.html
    // Our only process always runs with group ID 0.
    return 0;
  },
  tcsetpgrp__deps: ['__setErrNo', '$ERRNO_CODES'],
  tcsetpgrp: function(fildes, pgid_id) {
    // int tcsetpgrp(int fildes, pid_t pgid_id);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/tcsetpgrp.html
    // We don't support multiple processes or groups with ID other than 0.
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  },
  sysconf__deps: ['__setErrNo', '$ERRNO_CODES'],
  sysconf: function(name) {
    // long sysconf(int name);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/sysconf.html
    switch(name) {
      case {{{ cDefine('_SC_PAGE_SIZE') }}}: return PAGE_SIZE;
      case {{{ cDefine('_SC_ADVISORY_INFO') }}}:
      case {{{ cDefine('_SC_BARRIERS') }}}:
      case {{{ cDefine('_SC_ASYNCHRONOUS_IO') }}}:
      case {{{ cDefine('_SC_CLOCK_SELECTION') }}}:
      case {{{ cDefine('_SC_CPUTIME') }}}:
      case {{{ cDefine('_SC_FSYNC') }}}:
      case {{{ cDefine('_SC_IPV6') }}}:
      case {{{ cDefine('_SC_MAPPED_FILES') }}}:
      case {{{ cDefine('_SC_MEMLOCK') }}}:
      case {{{ cDefine('_SC_MEMLOCK_RANGE') }}}:
      case {{{ cDefine('_SC_MEMORY_PROTECTION') }}}:
      case {{{ cDefine('_SC_MESSAGE_PASSING') }}}:
      case {{{ cDefine('_SC_MONOTONIC_CLOCK') }}}:
      case {{{ cDefine('_SC_PRIORITIZED_IO') }}}:
      case {{{ cDefine('_SC_PRIORITY_SCHEDULING') }}}:
      case {{{ cDefine('_SC_RAW_SOCKETS') }}}:
      case {{{ cDefine('_SC_READER_WRITER_LOCKS') }}}:
      case {{{ cDefine('_SC_REALTIME_SIGNALS') }}}:
      case {{{ cDefine('_SC_SEMAPHORES') }}}:
      case {{{ cDefine('_SC_SHARED_MEMORY_OBJECTS') }}}:
      case {{{ cDefine('_SC_SPAWN') }}}:
      case {{{ cDefine('_SC_SPIN_LOCKS') }}}:
      case {{{ cDefine('_SC_SYNCHRONIZED_IO') }}}:
      case {{{ cDefine('_SC_THREAD_ATTR_STACKADDR') }}}:
      case {{{ cDefine('_SC_THREAD_ATTR_STACKSIZE') }}}:
      case {{{ cDefine('_SC_THREAD_CPUTIME') }}}:
      case {{{ cDefine('_SC_THREAD_PRIO_INHERIT') }}}:
      case {{{ cDefine('_SC_THREAD_PRIO_PROTECT') }}}:
      case {{{ cDefine('_SC_THREAD_PRIORITY_SCHEDULING') }}}:
      case {{{ cDefine('_SC_THREAD_PROCESS_SHARED') }}}:
      case {{{ cDefine('_SC_THREAD_SAFE_FUNCTIONS') }}}:
      case {{{ cDefine('_SC_THREADS') }}}:
      case {{{ cDefine('_SC_TIMEOUTS') }}}:
      case {{{ cDefine('_SC_TIMERS') }}}:
      case {{{ cDefine('_SC_VERSION') }}}:
      case {{{ cDefine('_SC_2_C_BIND') }}}:
      case {{{ cDefine('_SC_2_C_DEV') }}}:
      case {{{ cDefine('_SC_2_CHAR_TERM') }}}:
      case {{{ cDefine('_SC_2_LOCALEDEF') }}}:
      case {{{ cDefine('_SC_2_SW_DEV') }}}:
      case {{{ cDefine('_SC_2_VERSION') }}}:
        return 200809;
      case {{{ cDefine('_SC_MQ_OPEN_MAX') }}}:
      case {{{ cDefine('_SC_XOPEN_STREAMS') }}}:
      case {{{ cDefine('_SC_XBS5_LP64_OFF64') }}}:
      case {{{ cDefine('_SC_XBS5_LPBIG_OFFBIG') }}}:
      case {{{ cDefine('_SC_AIO_LISTIO_MAX') }}}:
      case {{{ cDefine('_SC_AIO_MAX') }}}:
      case {{{ cDefine('_SC_SPORADIC_SERVER') }}}:
      case {{{ cDefine('_SC_THREAD_SPORADIC_SERVER') }}}:
      case {{{ cDefine('_SC_TRACE') }}}:
      case {{{ cDefine('_SC_TRACE_EVENT_FILTER') }}}:
      case {{{ cDefine('_SC_TRACE_EVENT_NAME_MAX') }}}:
      case {{{ cDefine('_SC_TRACE_INHERIT') }}}:
      case {{{ cDefine('_SC_TRACE_LOG') }}}:
      case {{{ cDefine('_SC_TRACE_NAME_MAX') }}}:
      case {{{ cDefine('_SC_TRACE_SYS_MAX') }}}:
      case {{{ cDefine('_SC_TRACE_USER_EVENT_MAX') }}}:
      case {{{ cDefine('_SC_TYPED_MEMORY_OBJECTS') }}}:
      case {{{ cDefine('_SC_V6_LP64_OFF64') }}}:
      case {{{ cDefine('_SC_V6_LPBIG_OFFBIG') }}}:
      case {{{ cDefine('_SC_2_FORT_DEV') }}}:
      case {{{ cDefine('_SC_2_FORT_RUN') }}}:
      case {{{ cDefine('_SC_2_PBS') }}}:
      case {{{ cDefine('_SC_2_PBS_ACCOUNTING') }}}:
      case {{{ cDefine('_SC_2_PBS_CHECKPOINT') }}}:
      case {{{ cDefine('_SC_2_PBS_LOCATE') }}}:
      case {{{ cDefine('_SC_2_PBS_MESSAGE') }}}:
      case {{{ cDefine('_SC_2_PBS_TRACK') }}}:
      case {{{ cDefine('_SC_2_UPE') }}}:
      case {{{ cDefine('_SC_THREAD_THREADS_MAX') }}}:
      case {{{ cDefine('_SC_SEM_NSEMS_MAX') }}}:
      case {{{ cDefine('_SC_SYMLOOP_MAX') }}}:
      case {{{ cDefine('_SC_TIMER_MAX') }}}:
        return -1;
      case {{{ cDefine('_SC_V6_ILP32_OFF32') }}}:
      case {{{ cDefine('_SC_V6_ILP32_OFFBIG') }}}:
      case {{{ cDefine('_SC_JOB_CONTROL') }}}:
      case {{{ cDefine('_SC_REGEXP') }}}:
      case {{{ cDefine('_SC_SAVED_IDS') }}}:
      case {{{ cDefine('_SC_SHELL') }}}:
      case {{{ cDefine('_SC_XBS5_ILP32_OFF32') }}}:
      case {{{ cDefine('_SC_XBS5_ILP32_OFFBIG') }}}:
      case {{{ cDefine('_SC_XOPEN_CRYPT') }}}:
      case {{{ cDefine('_SC_XOPEN_ENH_I18N') }}}:
      case {{{ cDefine('_SC_XOPEN_LEGACY') }}}:
      case {{{ cDefine('_SC_XOPEN_REALTIME') }}}:
      case {{{ cDefine('_SC_XOPEN_REALTIME_THREADS') }}}:
      case {{{ cDefine('_SC_XOPEN_SHM') }}}:
      case {{{ cDefine('_SC_XOPEN_UNIX') }}}:
        return 1;
      case {{{ cDefine('_SC_THREAD_KEYS_MAX') }}}:
      case {{{ cDefine('_SC_IOV_MAX') }}}:
      case {{{ cDefine('_SC_GETGR_R_SIZE_MAX') }}}:
      case {{{ cDefine('_SC_GETPW_R_SIZE_MAX') }}}:
      case {{{ cDefine('_SC_OPEN_MAX') }}}:
        return 1024;
      case {{{ cDefine('_SC_RTSIG_MAX') }}}:
      case {{{ cDefine('_SC_EXPR_NEST_MAX') }}}:
      case {{{ cDefine('_SC_TTY_NAME_MAX') }}}:
        return 32;
      case {{{ cDefine('_SC_ATEXIT_MAX') }}}:
      case {{{ cDefine('_SC_DELAYTIMER_MAX') }}}:
      case {{{ cDefine('_SC_SEM_VALUE_MAX') }}}:
        return 2147483647;
      case {{{ cDefine('_SC_SIGQUEUE_MAX') }}}:
      case {{{ cDefine('_SC_CHILD_MAX') }}}:
        return 47839;
      case {{{ cDefine('_SC_BC_SCALE_MAX') }}}:
      case {{{ cDefine('_SC_BC_BASE_MAX') }}}:
        return 99;
      case {{{ cDefine('_SC_LINE_MAX') }}}:
      case {{{ cDefine('_SC_BC_DIM_MAX') }}}:
        return 2048;
      case {{{ cDefine('_SC_ARG_MAX') }}}: return 2097152;
      case {{{ cDefine('_SC_NGROUPS_MAX') }}}: return 65536;
      case {{{ cDefine('_SC_MQ_PRIO_MAX') }}}: return 32768;
      case {{{ cDefine('_SC_RE_DUP_MAX') }}}: return 32767;
      case {{{ cDefine('_SC_THREAD_STACK_MIN') }}}: return 16384;
      case {{{ cDefine('_SC_BC_STRING_MAX') }}}: return 1000;
      case {{{ cDefine('_SC_XOPEN_VERSION') }}}: return 700;
      case {{{ cDefine('_SC_LOGIN_NAME_MAX') }}}: return 256;
      case {{{ cDefine('_SC_COLL_WEIGHTS_MAX') }}}: return 255;
      case {{{ cDefine('_SC_CLK_TCK') }}}: return 100;
      case {{{ cDefine('_SC_HOST_NAME_MAX') }}}: return 64;
      case {{{ cDefine('_SC_AIO_PRIO_DELTA_MAX') }}}: return 20;
      case {{{ cDefine('_SC_STREAM_MAX') }}}: return 16;
      case {{{ cDefine('_SC_TZNAME_MAX') }}}: return 6;
      case {{{ cDefine('_SC_THREAD_DESTRUCTOR_ITERATIONS') }}}: return 4;
      case {{{ cDefine('_SC_NPROCESSORS_ONLN') }}}: return 1;
    }
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  },
  sbrk: function(bytes) {
    // Implement a Linux-like 'memory area' for our 'process'.
    // Changes the size of the memory area by |bytes|; returns the
    // address of the previous top ('break') of the memory area
    // We control the "dynamic" memory - DYNAMIC_BASE to DYNAMICTOP
    var self = _sbrk;
    if (!self.called) {
      DYNAMICTOP = alignMemoryPage(DYNAMICTOP); // make sure we start out aligned
      self.called = true;
      assert(Runtime.dynamicAlloc);
      self.alloc = Runtime.dynamicAlloc;
      Runtime.dynamicAlloc = function() { abort('cannot dynamically allocate, sbrk now has control') };
    }
    var ret = DYNAMICTOP;
    if (bytes != 0) self.alloc(bytes);
    return ret;  // Previous break location.
  },
  open64: 'open',
  lseek64: 'lseek',
  ftruncate64: 'ftruncate',
  __01open64_: 'open',
  __01lseek64_: 'lseek',
  __01truncate64_: 'truncate',
  __01ftruncate64_: 'ftruncate',
  // TODO: Check if any other aliases are needed.

  // ==========================================================================
  // stdio.h
  // ==========================================================================

  _isFloat: function(text) {
    return !!(/^[+-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$/.exec(text));
  },

  // TODO: Document.
  _scanString__deps: ['_isFloat'],
  _scanString: function(format, get, unget, varargs) {
    if (!__scanString.whiteSpace) {
      __scanString.whiteSpace = {};
      __scanString.whiteSpace[{{{ charCode(' ') }}}] = 1;
      __scanString.whiteSpace[{{{ charCode('\t') }}}] = 1;
      __scanString.whiteSpace[{{{ charCode('\n') }}}] = 1;
      __scanString.whiteSpace[{{{ charCode('\v') }}}] = 1;
      __scanString.whiteSpace[{{{ charCode('\f') }}}] = 1;
      __scanString.whiteSpace[{{{ charCode('\r') }}}] = 1;
      __scanString.whiteSpace[' '] = 1;
      __scanString.whiteSpace['\t'] = 1;
      __scanString.whiteSpace['\n'] = 1;
      __scanString.whiteSpace['\v'] = 1;
      __scanString.whiteSpace['\f'] = 1;
      __scanString.whiteSpace['\r'] = 1;
    }
    // Supports %x, %4x, %d.%d, %lld, %s, %f, %lf.
    // TODO: Support all format specifiers.
    format = Pointer_stringify(format);
    var soFar = 0;
    if (format.indexOf('%n') >= 0) {
      // need to track soFar
      var _get = get;
      get = function() {
        soFar++;
        return _get();
      }
      var _unget = unget;
      unget = function() {
        soFar--;
        return _unget();
      }
    }
    var formatIndex = 0;
    var argsi = 0;
    var fields = 0;
    var argIndex = 0;
    var next;

    mainLoop:
    for (var formatIndex = 0; formatIndex < format.length;) {
      if (format[formatIndex] === '%' && format[formatIndex+1] == 'n') {
        var argPtr = {{{ makeGetValue('varargs', 'argIndex', 'void*') }}};
        argIndex += Runtime.getAlignSize('void*', null, true);
        {{{ makeSetValue('argPtr', 0, 'soFar', 'i32') }}};
        formatIndex += 2;
        continue;
      }

      if (format[formatIndex] === '%') {
        var nextC = format.indexOf('c', formatIndex+1);
        if (nextC > 0) {
          var maxx = 1;
          if (nextC > formatIndex+1) {
            var sub = format.substring(formatIndex+1, nextC)
            maxx = parseInt(sub);
            if (maxx != sub) maxx = 0;
          }
          if (maxx) {
            var argPtr = {{{ makeGetValue('varargs', 'argIndex', 'void*') }}};
            argIndex += Runtime.getAlignSize('void*', null, true);
            fields++;
            for (var i = 0; i < maxx; i++) {
              next = get();
              {{{ makeSetValue('argPtr++', 0, 'next', 'i8') }}};
            }
            formatIndex += nextC - formatIndex + 1;
            continue;
          }
        }
      }

      // remove whitespace
      while (1) {
        next = get();
        if (next == 0) return fields;
        if (!(next in __scanString.whiteSpace)) break;
      }
      unget();

      if (format[formatIndex] === '%') {
        formatIndex++;
        var suppressAssignment = false;
        if (format[formatIndex] == '*') {
          suppressAssignment = true;
          formatIndex++;
        }
        var maxSpecifierStart = formatIndex;
        while (format[formatIndex].charCodeAt(0) >= {{{ charCode('0') }}} &&
               format[formatIndex].charCodeAt(0) <= {{{ charCode('9') }}}) {
          formatIndex++;
        }
        var max_;
        if (formatIndex != maxSpecifierStart) {
          max_ = parseInt(format.slice(maxSpecifierStart, formatIndex), 10);
        }
        var long_ = false;
        var half = false;
        var longLong = false;
        if (format[formatIndex] == 'l') {
          long_ = true;
          formatIndex++;
          if (format[formatIndex] == 'l') {
            longLong = true;
            formatIndex++;
          }
        } else if (format[formatIndex] == 'h') {
          half = true;
          formatIndex++;
        }
        var type = format[formatIndex];
        formatIndex++;
        var curr = 0;
        var buffer = [];
        // Read characters according to the format. floats are trickier, they may be in an unfloat state in the middle, then be a valid float later
        if (type == 'f' || type == 'e' || type == 'g' ||
            type == 'F' || type == 'E' || type == 'G') {
          var last = 0;
          next = get();
          while (next > 0) {
            buffer.push(String.fromCharCode(next));
            if (__isFloat(buffer.join(''))) {
              last = buffer.length;
            }
            next = get();
          }
          for (var i = 0; i < buffer.length - last + 1; i++) {
            unget();
          }
          buffer.length = last;
        } else {
          next = get();
          var first = true;
          while ((curr < max_ || isNaN(max_)) && next > 0) {
            if (!(next in __scanString.whiteSpace) && // stop on whitespace
                (type == 's' ||
                 ((type === 'd' || type == 'u' || type == 'i') && ((next >= {{{ charCode('0') }}} && next <= {{{ charCode('9') }}}) ||
                                                                   (first && next == {{{ charCode('-') }}}))) ||
                 ((type === 'x' || type === 'X') && (next >= {{{ charCode('0') }}} && next <= {{{ charCode('9') }}} ||
                                   next >= {{{ charCode('a') }}} && next <= {{{ charCode('f') }}} ||
                                   next >= {{{ charCode('A') }}} && next <= {{{ charCode('F') }}}))) &&
                (formatIndex >= format.length || next !== format[formatIndex].charCodeAt(0))) { // Stop when we read something that is coming up
              buffer.push(String.fromCharCode(next));
              next = get();
              curr++;
              first = false;
            } else {
              break;
            }
          }
          unget();
        }
        if (buffer.length === 0) return 0;  // Failure.
        if (suppressAssignment) continue;

        var text = buffer.join('');
        var argPtr = {{{ makeGetValue('varargs', 'argIndex', 'void*') }}};
        argIndex += Runtime.getAlignSize('void*', null, true);
        switch (type) {
          case 'd': case 'u': case 'i':
            if (half) {
              {{{ makeSetValue('argPtr', 0, 'parseInt(text, 10)', 'i16') }}};
            } else if (longLong) {
              {{{ makeSetValue('argPtr', 0, 'parseInt(text, 10)', 'i64') }}};
            } else {
              {{{ makeSetValue('argPtr', 0, 'parseInt(text, 10)', 'i32') }}};
            }
            break;
          case 'X':
          case 'x':
            {{{ makeSetValue('argPtr', 0, 'parseInt(text, 16)', 'i32') }}}
            break;
          case 'F':
          case 'f':
          case 'E':
          case 'e':
          case 'G':
          case 'g':
          case 'E':
            // fallthrough intended
            if (long_) {
              {{{ makeSetValue('argPtr', 0, 'parseFloat(text)', 'double') }}}
            } else {
              {{{ makeSetValue('argPtr', 0, 'parseFloat(text)', 'float') }}}
            }
            break;
          case 's':
            var array = intArrayFromString(text);
            for (var j = 0; j < array.length; j++) {
              {{{ makeSetValue('argPtr', 'j', 'array[j]', 'i8') }}}
            }
            break;
        }
        fields++;
      } else if (format[formatIndex] in __scanString.whiteSpace) {
        next = get();
        while (next in __scanString.whiteSpace) {
          if (next <= 0) break mainLoop;  // End of input.
          next = get();
        }
        unget(next);
        formatIndex++;
      } else {
        // Not a specifier.
        next = get();
        if (format[formatIndex].charCodeAt(0) !== next) {
          unget(next);
          break mainLoop;
        }
        formatIndex++;
      }
    }
    return fields;
  },
  // Performs printf-style formatting.
  //   format: A pointer to the format string.
  //   varargs: A pointer to the start of the arguments list.
  // Returns the resulting string string as a character array.
  _formatString__deps: ['strlen', '_reallyNegative'],
  _formatString: function(format, varargs) {
    var textIndex = format;
    var argIndex = 0;
    function getNextArg(type) {
      // NOTE: Explicitly ignoring type safety. Otherwise this fails:
      //       int x = 4; printf("%c\n", (char)x);
      var ret;
      if (type === 'double') {
        ret = {{{ makeGetValue('varargs', 'argIndex', 'double', undefined, undefined, true) }}};
#if USE_TYPED_ARRAYS == 2
      } else if (type == 'i64') {

#if TARGET_LE32
        ret = [{{{ makeGetValue('varargs', 'argIndex', 'i32', undefined, undefined, true) }}},
               {{{ makeGetValue('varargs', 'argIndex+8', 'i32', undefined, undefined, true) }}}];
        argIndex += {{{ STACK_ALIGN }}}; // each 32-bit chunk is in a 64-bit block
#else
        ret = [{{{ makeGetValue('varargs', 'argIndex', 'i32', undefined, undefined, true) }}},
               {{{ makeGetValue('varargs', 'argIndex+4', 'i32', undefined, undefined, true) }}}];
#endif

#else
      } else if (type == 'i64') {
        ret = {{{ makeGetValue('varargs', 'argIndex', 'i64', undefined, undefined, true) }}};
#endif
      } else {
        type = 'i32'; // varargs are always i32, i64, or double
        ret = {{{ makeGetValue('varargs', 'argIndex', 'i32', undefined, undefined, true) }}};
      }
      argIndex += Math.max(Runtime.getNativeFieldSize(type), Runtime.getAlignSize(type, null, true));
      return ret;
    }

    var ret = [];
    var curr, next, currArg;
    while(1) {
      var startTextIndex = textIndex;
      curr = {{{ makeGetValue(0, 'textIndex', 'i8') }}};
      if (curr === 0) break;
      next = {{{ makeGetValue(0, 'textIndex+1', 'i8') }}};
      if (curr == {{{ charCode('%') }}}) {
        // Handle flags.
        var flagAlwaysSigned = false;
        var flagLeftAlign = false;
        var flagAlternative = false;
        var flagZeroPad = false;
        flagsLoop: while (1) {
          switch (next) {
            case {{{ charCode('+') }}}:
              flagAlwaysSigned = true;
              break;
            case {{{ charCode('-') }}}:
              flagLeftAlign = true;
              break;
            case {{{ charCode('#') }}}:
              flagAlternative = true;
              break;
            case {{{ charCode('0') }}}:
              if (flagZeroPad) {
                break flagsLoop;
              } else {
                flagZeroPad = true;
                break;
              }
            default:
              break flagsLoop;
          }
          textIndex++;
          next = {{{ makeGetValue(0, 'textIndex+1', 'i8') }}};
        }

        // Handle width.
        var width = 0;
        if (next == {{{ charCode('*') }}}) {
          width = getNextArg('i32');
          textIndex++;
          next = {{{ makeGetValue(0, 'textIndex+1', 'i8') }}};
        } else {
          while (next >= {{{ charCode('0') }}} && next <= {{{ charCode('9') }}}) {
            width = width * 10 + (next - {{{ charCode('0') }}});
            textIndex++;
            next = {{{ makeGetValue(0, 'textIndex+1', 'i8') }}};
          }
        }

        // Handle precision.
        var precisionSet = false;
        if (next == {{{ charCode('.') }}}) {
          var precision = 0;
          precisionSet = true;
          textIndex++;
          next = {{{ makeGetValue(0, 'textIndex+1', 'i8') }}};
          if (next == {{{ charCode('*') }}}) {
            precision = getNextArg('i32');
            textIndex++;
          } else {
            while(1) {
              var precisionChr = {{{ makeGetValue(0, 'textIndex+1', 'i8') }}};
              if (precisionChr < {{{ charCode('0') }}} ||
                  precisionChr > {{{ charCode('9') }}}) break;
              precision = precision * 10 + (precisionChr - {{{ charCode('0') }}});
              textIndex++;
            }
          }
          next = {{{ makeGetValue(0, 'textIndex+1', 'i8') }}};
        } else {
          var precision = 6; // Standard default.
        }

        // Handle integer sizes. WARNING: These assume a 32-bit architecture!
        var argSize;
        switch (String.fromCharCode(next)) {
          case 'h':
            var nextNext = {{{ makeGetValue(0, 'textIndex+2', 'i8') }}};
            if (nextNext == {{{ charCode('h') }}}) {
              textIndex++;
              argSize = 1; // char (actually i32 in varargs)
            } else {
              argSize = 2; // short (actually i32 in varargs)
            }
            break;
          case 'l':
            var nextNext = {{{ makeGetValue(0, 'textIndex+2', 'i8') }}};
            if (nextNext == {{{ charCode('l') }}}) {
              textIndex++;
              argSize = 8; // long long
            } else {
              argSize = 4; // long
            }
            break;
          case 'L': // long long
          case 'q': // int64_t
          case 'j': // intmax_t
            argSize = 8;
            break;
          case 'z': // size_t
          case 't': // ptrdiff_t
          case 'I': // signed ptrdiff_t or unsigned size_t
            argSize = 4;
            break;
          default:
            argSize = null;
        }
        if (argSize) textIndex++;
        next = {{{ makeGetValue(0, 'textIndex+1', 'i8') }}};

        // Handle type specifier.
        switch (String.fromCharCode(next)) {
          case 'd': case 'i': case 'u': case 'o': case 'x': case 'X': case 'p': {
            // Integer.
            var signed = next == {{{ charCode('d') }}} || next == {{{ charCode('i') }}};
            argSize = argSize || 4;
            var currArg = getNextArg('i' + (argSize * 8));
#if PRECISE_I64_MATH
            var origArg = currArg;
#endif
            var argText;
#if USE_TYPED_ARRAYS == 2
            // Flatten i64-1 [low, high] into a (slightly rounded) double
            if (argSize == 8) {
              currArg = Runtime.makeBigInt(currArg[0], currArg[1], next == {{{ charCode('u') }}});
            }
#endif
            // Truncate to requested size.
            if (argSize <= 4) {
              var limit = Math.pow(256, argSize) - 1;
              currArg = (signed ? reSign : unSign)(currArg & limit, argSize * 8);
            }
            // Format the number.
            var currAbsArg = Math.abs(currArg);
            var prefix = '';
            if (next == {{{ charCode('d') }}} || next == {{{ charCode('i') }}}) {
#if PRECISE_I64_MATH
              if (argSize == 8 && i64Math) argText = i64Math.stringify(origArg[0], origArg[1], null); else
#endif
              argText = reSign(currArg, 8 * argSize, 1).toString(10);
            } else if (next == {{{ charCode('u') }}}) {
#if PRECISE_I64_MATH
              if (argSize == 8 && i64Math) argText = i64Math.stringify(origArg[0], origArg[1], true); else
#endif
              argText = unSign(currArg, 8 * argSize, 1).toString(10);
              currArg = Math.abs(currArg);
            } else if (next == {{{ charCode('o') }}}) {
              argText = (flagAlternative ? '0' : '') + currAbsArg.toString(8);
            } else if (next == {{{ charCode('x') }}} || next == {{{ charCode('X') }}}) {
              prefix = (flagAlternative && currArg != 0) ? '0x' : '';
#if PRECISE_I64_MATH
              if (argSize == 8 && i64Math) {
                if (origArg[1]) {
                  argText = (origArg[1]>>>0).toString(16);
                  var lower = (origArg[0]>>>0).toString(16);
                  while (lower.length < 8) lower = '0' + lower;
                  argText += lower;
                } else {
                  argText = (origArg[0]>>>0).toString(16);
                }
              } else
#endif
              if (currArg < 0) {
                // Represent negative numbers in hex as 2's complement.
                currArg = -currArg;
                argText = (currAbsArg - 1).toString(16);
                var buffer = [];
                for (var i = 0; i < argText.length; i++) {
                  buffer.push((0xF - parseInt(argText[i], 16)).toString(16));
                }
                argText = buffer.join('');
                while (argText.length < argSize * 2) argText = 'f' + argText;
              } else {
                argText = currAbsArg.toString(16);
              }
              if (next == {{{ charCode('X') }}}) {
                prefix = prefix.toUpperCase();
                argText = argText.toUpperCase();
              }
            } else if (next == {{{ charCode('p') }}}) {
              if (currAbsArg === 0) {
                argText = '(nil)';
              } else {
                prefix = '0x';
                argText = currAbsArg.toString(16);
              }
            }
            if (precisionSet) {
              while (argText.length < precision) {
                argText = '0' + argText;
              }
            }

            // Add sign if needed
            if (flagAlwaysSigned) {
              if (currArg < 0) {
                prefix = '-' + prefix;
              } else {
                prefix = '+' + prefix;
              }
            }

            // Add padding.
            while (prefix.length + argText.length < width) {
              if (flagLeftAlign) {
                argText += ' ';
              } else {
                if (flagZeroPad) {
                  argText = '0' + argText;
                } else {
                  prefix = ' ' + prefix;
                }
              }
            }

            // Insert the result into the buffer.
            argText = prefix + argText;
            argText.split('').forEach(function(chr) {
              ret.push(chr.charCodeAt(0));
            });
            break;
          }
          case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': {
            // Float.
            var currArg = getNextArg('double');
            var argText;
            if (isNaN(currArg)) {
              argText = 'nan';
              flagZeroPad = false;
            } else if (!isFinite(currArg)) {
              argText = (currArg < 0 ? '-' : '') + 'inf';
              flagZeroPad = false;
            } else {
              var isGeneral = false;
              var effectivePrecision = Math.min(precision, 20);

              // Convert g/G to f/F or e/E, as per:
              // http://pubs.opengroup.org/onlinepubs/9699919799/functions/printf.html
              if (next == {{{ charCode('g') }}} || next == {{{ charCode('G') }}}) {
                isGeneral = true;
                precision = precision || 1;
                var exponent = parseInt(currArg.toExponential(effectivePrecision).split('e')[1], 10);
                if (precision > exponent && exponent >= -4) {
                  next = ((next == {{{ charCode('g') }}}) ? 'f' : 'F').charCodeAt(0);
                  precision -= exponent + 1;
                } else {
                  next = ((next == {{{ charCode('g') }}}) ? 'e' : 'E').charCodeAt(0);
                  precision--;
                }
                effectivePrecision = Math.min(precision, 20);
              }

              if (next == {{{ charCode('e') }}} || next == {{{ charCode('E') }}}) {
                argText = currArg.toExponential(effectivePrecision);
                // Make sure the exponent has at least 2 digits.
                if (/[eE][-+]\d$/.test(argText)) {
                  argText = argText.slice(0, -1) + '0' + argText.slice(-1);
                }
              } else if (next == {{{ charCode('f') }}} || next == {{{ charCode('F') }}}) {
                argText = currArg.toFixed(effectivePrecision);
                if (currArg === 0 && __reallyNegative(currArg)) {
                  argText = '-' + argText;
                }
              }

              var parts = argText.split('e');
              if (isGeneral && !flagAlternative) {
                // Discard trailing zeros and periods.
                while (parts[0].length > 1 && parts[0].indexOf('.') != -1 &&
                       (parts[0].slice(-1) == '0' || parts[0].slice(-1) == '.')) {
                  parts[0] = parts[0].slice(0, -1);
                }
              } else {
                // Make sure we have a period in alternative mode.
                if (flagAlternative && argText.indexOf('.') == -1) parts[0] += '.';
                // Zero pad until required precision.
                while (precision > effectivePrecision++) parts[0] += '0';
              }
              argText = parts[0] + (parts.length > 1 ? 'e' + parts[1] : '');

              // Capitalize 'E' if needed.
              if (next == {{{ charCode('E') }}}) argText = argText.toUpperCase();

              // Add sign.
              if (flagAlwaysSigned && currArg >= 0) {
                argText = '+' + argText;
              }
            }

            // Add padding.
            while (argText.length < width) {
              if (flagLeftAlign) {
                argText += ' ';
              } else {
                if (flagZeroPad && (argText[0] == '-' || argText[0] == '+')) {
                  argText = argText[0] + '0' + argText.slice(1);
                } else {
                  argText = (flagZeroPad ? '0' : ' ') + argText;
                }
              }
            }

            // Adjust case.
            if (next < {{{ charCode('a') }}}) argText = argText.toUpperCase();

            // Insert the result into the buffer.
            argText.split('').forEach(function(chr) {
              ret.push(chr.charCodeAt(0));
            });
            break;
          }
          case 's': {
            // String.
            var arg = getNextArg('i8*');
            var argLength = arg ? _strlen(arg) : '(null)'.length;
            if (precisionSet) argLength = Math.min(argLength, precision);
            if (!flagLeftAlign) {
              while (argLength < width--) {
                ret.push({{{ charCode(' ') }}});
              }
            }
            if (arg) {
              for (var i = 0; i < argLength; i++) {
                ret.push({{{ makeGetValue('arg++', 0, 'i8', null, true) }}});
              }
            } else {
              ret = ret.concat(intArrayFromString('(null)'.substr(0, argLength), true));
            }
            if (flagLeftAlign) {
              while (argLength < width--) {
                ret.push({{{ charCode(' ') }}});
              }
            }
            break;
          }
          case 'c': {
            // Character.
            if (flagLeftAlign) ret.push(getNextArg('i8'));
            while (--width > 0) {
              ret.push({{{ charCode(' ') }}});
            }
            if (!flagLeftAlign) ret.push(getNextArg('i8'));
            break;
          }
          case 'n': {
            // Write the length written so far to the next parameter.
            var ptr = getNextArg('i32*');
            {{{ makeSetValue('ptr', '0', 'ret.length', 'i32') }}}
            break;
          }
          case '%': {
            // Literal percent sign.
            ret.push(curr);
            break;
          }
          default: {
            // Unknown specifiers remain untouched.
            for (var i = startTextIndex; i < textIndex + 2; i++) {
              ret.push({{{ makeGetValue(0, 'i', 'i8') }}});
            }
          }
        }
        textIndex += 2;
        // TODO: Support a/A (hex float) and m (last error) specifiers.
        // TODO: Support %1${specifier} for arg selection.
      } else {
        ret.push(curr);
        textIndex += 1;
      }
    }
    return ret;
  },
  // NOTE: Invalid stream pointers passed to these functions would cause a crash
  //       in native code. We, on the other hand, just ignore them, since it's
  //       easier.
  clearerr__deps: ['$FS'],
  clearerr: function(stream) {
    // void clearerr(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/clearerr.html
    stream = FS.getStream(stream);
    if (stream) stream.error = false;
  },
  fclose__deps: ['close', 'fsync'],
  fclose: function(stream) {
    // int fclose(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fclose.html
    _fsync(stream);
    return _close(stream);
  },
  fdopen__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  fdopen: function(fildes, mode) {
    // FILE *fdopen(int fildes, const char *mode);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fdopen.html
    mode = Pointer_stringify(mode);
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return 0;
    }
    if ((mode.indexOf('w') != -1 && !stream.isWrite) ||
        (mode.indexOf('r') != -1 && !stream.isRead) ||
        (mode.indexOf('a') != -1 && !stream.isAppend) ||
        (mode.indexOf('+') != -1 && (!stream.isRead || !stream.isWrite))) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return 0;
    } else {
      stream.error = false;
      stream.eof = false;
      return fildes;
    }
  },
  feof__deps: ['$FS'],
  feof: function(stream) {
    // int feof(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/feof.html
    stream = FS.getStream(stream);
    return Number(stream && stream.eof);
  },
  ferror__deps: ['$FS'],
  ferror: function(stream) {
    // int ferror(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/ferror.html
    stream = FS.getStream(stream);
    return Number(stream && stream.error);
  },
  fflush__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  fflush: function(stream) {
    // int fflush(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fflush.html
    // we don't currently perform any user-space buffering of data
  },
  fgetc__deps: ['$FS', 'fread'],
  fgetc__postset: '_fgetc.ret = allocate([0], "i8", ALLOC_STATIC);',
  fgetc: function(stream) {
    // int fgetc(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fgetc.html
    var streamObj = FS.getStream(stream);
    if (!streamObj) return -1;
    if (streamObj.eof || streamObj.error) return -1;
    var ret = _fread(_fgetc.ret, 1, 1, stream);
    if (ret == 0) {
      streamObj.eof = true;
      return -1;
    } else if (ret == -1) {
      streamObj.error = true;
      return -1;
    } else {
      return {{{ makeGetValue('_fgetc.ret', '0', 'i8', null, 1) }}};
    }
  },
  getc: 'fgetc',
  getc_unlocked: 'fgetc',
  getchar__deps: ['fgetc', 'stdin'],
  getchar: function() {
    // int getchar(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/getchar.html
    return _fgetc({{{ makeGetValue(makeGlobalUse('_stdin'), '0', 'void*') }}});
  },
  fgetpos__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  fgetpos: function(stream, pos) {
    // int fgetpos(FILE *restrict stream, fpos_t *restrict pos);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fgetpos.html
    stream = FS.getStream(stream);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    if (FS.isChrdev(stream.node.mode)) {
      ___setErrNo(ERRNO_CODES.ESPIPE);
      return -1;
    }
    {{{ makeSetValue('pos', '0', 'stream.position', 'i32') }}}
    var state = (stream.eof ? 1 : 0) + (stream.error ? 2 : 0);
    {{{ makeSetValue('pos', Runtime.getNativeTypeSize('i32'), 'state', 'i32') }}}
    return 0;
  },
  fgets__deps: ['fgetc'],
  fgets: function(s, n, stream) {
    // char *fgets(char *restrict s, int n, FILE *restrict stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fgets.html
    var streamObj = FS.getStream(stream);
    if (!streamObj) return 0;
    if (streamObj.error || streamObj.eof) return 0;
    var byte_;
    for (var i = 0; i < n - 1 && byte_ != {{{ charCode('\n') }}}; i++) {
      byte_ = _fgetc(stream);
      if (byte_ == -1) {
        if (streamObj.error || (streamObj.eof && i == 0)) return 0;
        else if (streamObj.eof) break;
      }
      {{{ makeSetValue('s', 'i', 'byte_', 'i8') }}}
    }
    {{{ makeSetValue('s', 'i', '0', 'i8') }}}
    return s;
  },
  gets__deps: ['fgets'],
  gets: function(s) {
    // char *gets(char *s);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/gets.html
    return _fgets(s, 1e6, {{{ makeGetValue(makeGlobalUse('_stdin'), '0', 'void*') }}});
  },
  fileno: function(stream) {
    // int fileno(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fileno.html
    // We use file descriptor numbers and FILE* streams interchangeably.
    return stream;
  },
  ftrylockfile: function() {
    // int ftrylockfile(FILE *file);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/flockfile.html
    // Locking is useless in a single-threaded environment. Pretend to succeed.
    return 0;
  },
  flockfile: 'ftrylockfile',
  funlockfile: 'ftrylockfile',
  fopen__deps: ['$FS', '__setErrNo', '$ERRNO_CODES', 'open'],
  fopen: function(filename, mode) {
    // FILE *fopen(const char *restrict filename, const char *restrict mode);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fopen.html
    var flags;
    mode = Pointer_stringify(mode);
    if (mode[0] == 'r') {
      if (mode.indexOf('+') != -1) {
        flags = {{{ cDefine('O_RDWR') }}};
      } else {
        flags = {{{ cDefine('O_RDONLY') }}};
      }
    } else if (mode[0] == 'w') {
      if (mode.indexOf('+') != -1) {
        flags = {{{ cDefine('O_RDWR') }}};
      } else {
        flags = {{{ cDefine('O_WRONLY') }}};
      }
      flags |= {{{ cDefine('O_CREAT') }}};
      flags |= {{{ cDefine('O_TRUNC') }}};
    } else if (mode[0] == 'a') {
      if (mode.indexOf('+') != -1) {
        flags = {{{ cDefine('O_RDWR') }}};
      } else {
        flags = {{{ cDefine('O_WRONLY') }}};
      }
      flags |= {{{ cDefine('O_CREAT') }}};
      flags |= {{{ cDefine('O_APPEND') }}};
    } else {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return 0;
    }
    var ret = _open(filename, flags, allocate([0x1FF, 0, 0, 0], 'i32', ALLOC_STACK));  // All creation permissions.
    return (ret == -1) ? 0 : ret;
  },
  fputc__deps: ['$FS', 'write'],
  fputc__postset: '_fputc.ret = allocate([0], "i8", ALLOC_STATIC);',
  fputc: function(c, stream) {
    // int fputc(int c, FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fputc.html
    var chr = unSign(c & 0xFF);
    {{{ makeSetValue('_fputc.ret', '0', 'chr', 'i8') }}}
    var ret = _write(stream, _fputc.ret, 1);
    if (ret == -1) {
      var streamObj = FS.getStream(stream);
      if (streamObj) streamObj.error = true;
      return -1;
    } else {
      return chr;
    }
  },
  putc: 'fputc',
  putc_unlocked: 'fputc',
  putchar__deps: ['fputc', 'stdout'],
  putchar: function(c) {
    // int putchar(int c);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/putchar.html
    return _fputc(c, {{{ makeGetValue(makeGlobalUse('_stdout'), '0', 'void*') }}});
  },
  putchar_unlocked: 'putchar',
  fputs__deps: ['write', 'strlen'],
  fputs: function(s, stream) {
    // int fputs(const char *restrict s, FILE *restrict stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fputs.html
    return _write(stream, s, _strlen(s));
  },
  puts__deps: ['fputs', 'fputc', 'stdout'],
  puts: function(s) {
    // int puts(const char *s);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/puts.html
    // NOTE: puts() always writes an extra newline.
    var stdout = {{{ makeGetValue(makeGlobalUse('_stdout'), '0', 'void*') }}};
    var ret = _fputs(s, stdout);
    if (ret < 0) {
      return ret;
    } else {
      var newlineRet = _fputc({{{ charCode('\n') }}}, stdout);
      return (newlineRet < 0) ? -1 : ret + 1;
    }
  },
  fread__deps: ['$FS', 'read'],
  fread: function(ptr, size, nitems, stream) {
    // size_t fread(void *restrict ptr, size_t size, size_t nitems, FILE *restrict stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fread.html
    var bytesToRead = nitems * size;
    if (bytesToRead == 0) {
      return 0;
    }
    var bytesRead = 0;
    var streamObj = FS.getStream(stream);
    while (streamObj.ungotten.length && bytesToRead > 0) {
      {{{ makeSetValue('ptr++', '0', 'streamObj.ungotten.pop()', 'i8') }}}
      bytesToRead--;
      bytesRead++;
    }
    var err = _read(stream, ptr, bytesToRead);
    if (err == -1) {
      if (streamObj) streamObj.error = true;
      return 0;
    }
    bytesRead += err;
    if (bytesRead < bytesToRead) streamObj.eof = true;
    return Math.floor(bytesRead / size);
  },
  freopen__deps: ['$FS', 'fclose', 'fopen', '__setErrNo', '$ERRNO_CODES'],
  freopen: function(filename, mode, stream) {
    // FILE *freopen(const char *restrict filename, const char *restrict mode, FILE *restrict stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/freopen.html
    if (!filename) {
      var streamObj = FS.getStream(stream);
      if (!streamObj) {
        ___setErrNo(ERRNO_CODES.EBADF);
        return 0;
      }
      if (_freopen.buffer) _free(_freopen.buffer);
      filename = intArrayFromString(streamObj.path);
      filename = allocate(filename, 'i8', ALLOC_NORMAL);
    }
    _fclose(stream);
    return _fopen(filename, mode);
  },
  fseek__deps: ['$FS', 'lseek'],
  fseek: function(stream, offset, whence) {
    // int fseek(FILE *stream, long offset, int whence);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fseek.html
    var ret = _lseek(stream, offset, whence);
    if (ret == -1) {
      return -1;
    }
    stream = FS.getStream(stream);
    stream.eof = false;
    return 0;
  },
  fseeko: 'fseek',
  fseeko64: 'fseek',
  fsetpos__deps: ['$FS', 'lseek', '__setErrNo', '$ERRNO_CODES'],
  fsetpos: function(stream, pos) {
    // int fsetpos(FILE *stream, const fpos_t *pos);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fsetpos.html
    stream = FS.getStream(stream);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    if (FS.isChrdev(stream.node.mode)) {
      ___setErrNo(ERRNO_CODES.EPIPE);
      return -1;
    }
    stream.position = {{{ makeGetValue('pos', '0', 'i32') }}};
    var state = {{{ makeGetValue('pos', Runtime.getNativeTypeSize('i32'), 'i32') }}};
    stream.eof = Boolean(state & 1);
    stream.error = Boolean(state & 2);
    return 0;
  },
  ftell__deps: ['$FS', '__setErrNo', '$ERRNO_CODES'],
  ftell: function(stream) {
    // long ftell(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/ftell.html
    stream = FS.getStream(stream);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
    if (FS.isChrdev(stream.node.mode)) {
      ___setErrNo(ERRNO_CODES.ESPIPE);
      return -1;
    } else {
      return stream.position;
    }
  },
  ftello: 'ftell',
  ftello64: 'ftell',
  fwrite__deps: ['$FS', 'write'],
  fwrite: function(ptr, size, nitems, stream) {
    // size_t fwrite(const void *restrict ptr, size_t size, size_t nitems, FILE *restrict stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/fwrite.html
    var bytesToWrite = nitems * size;
    if (bytesToWrite == 0) return 0;
    var bytesWritten = _write(stream, ptr, bytesToWrite);
    if (bytesWritten == -1) {
      var streamObj = FS.getStream(stream);
      if (streamObj) streamObj.error = true;
      return 0;
    } else {
      return Math.floor(bytesWritten / size);
    }
  },
  popen__deps: ['__setErrNo', '$ERRNO_CODES'],
  popen: function(command, mode) {
    // FILE *popen(const char *command, const char *mode);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/popen.html
    // We allow only one process, so no pipes.
    ___setErrNo(ERRNO_CODES.EMFILE);
    return 0;
  },
  pclose__deps: ['__setErrNo', '$ERRNO_CODES'],
  pclose: function(stream) {
    // int pclose(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/pclose.html
    // We allow only one process, so no pipes.
    ___setErrNo(ERRNO_CODES.ECHILD);
    return -1;
  },
  perror__deps: ['puts', 'fputs', 'fputc', 'strerror', '__errno_location'],
  perror: function(s) {
    // void perror(const char *s);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/perror.html
    var stdout = {{{ makeGetValue(makeGlobalUse('_stdout'), '0', 'void*') }}};
    if (s) {
      _fputs(s, stdout);
      _fputc({{{ charCode(':') }}}, stdout);
      _fputc({{{ charCode(' ') }}}, stdout);
    }
    var errnum = {{{ makeGetValue('___errno_location()', '0', 'i32') }}};
    _puts(_strerror(errnum));
  },
  remove__deps: ['unlink', 'rmdir'],
  remove: function(path) {
    // int remove(const char *path);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/remove.html
    var ret = _unlink(path);
    if (ret == -1) ret = _rmdir(path);
    return ret;
  },
  rename__deps: ['__setErrNo', '$ERRNO_CODES'],
  rename: function(old_path, new_path) {
    // int rename(const char *old, const char *new);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/rename.html
    old_path = Pointer_stringify(old_path);
    new_path = Pointer_stringify(new_path);
    try {
      FS.rename(old_path, new_path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  },
  rewind__deps: ['$FS', 'fseek'],
  rewind: function(stream) {
    // void rewind(FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/rewind.html
    _fseek(stream, 0, 0);  // SEEK_SET.
    var streamObj = FS.getStream(stream);
    if (streamObj) streamObj.error = false;
  },
  setvbuf: function(stream, buf, type, size) {
    // int setvbuf(FILE *restrict stream, char *restrict buf, int type, size_t size);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/setvbuf.html
    // TODO: Implement custom buffering.
    return 0;
  },
  setbuf__deps: ['setvbuf'],
  setbuf: function(stream, buf) {
    // void setbuf(FILE *restrict stream, char *restrict buf);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/setbuf.html
    if (buf) _setvbuf(stream, buf, 0, 8192);  // _IOFBF, BUFSIZ.
    else _setvbuf(stream, buf, 2, 8192);  // _IONBF, BUFSIZ.
  },
  tmpnam__deps: ['$FS'],
  tmpnam: function(s, dir, prefix) {
    // char *tmpnam(char *s);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/tmpnam.html
    // NOTE: The dir and prefix arguments are for internal use only.
    var folder = FS.findObject(dir || '/tmp');
    if (!folder || !folder.isFolder) {
      dir = '/tmp';
      folder = FS.findObject(dir);
      if (!folder || !folder.isFolder) return 0;
    }
    var name = prefix || 'file';
    do {
      name += String.fromCharCode(65 + Math.floor(Math.random() * 25));
    } while (name in folder.contents);
    var result = dir + '/' + name;
    if (!_tmpnam.buffer) _tmpnam.buffer = _malloc(256);
    if (!s) s = _tmpnam.buffer;
    for (var i = 0; i < result.length; i++) {
      {{{ makeSetValue('s', 'i', 'result.charCodeAt(i)', 'i8') }}};
    }
    {{{ makeSetValue('s', 'i', '0', 'i8') }}};
    return s;
  },
  tempnam__deps: ['tmpnam'],
  tempnam: function(dir, pfx) {
    // char *tempnam(const char *dir, const char *pfx);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/tempnam.html
    return _tmpnam(0, Pointer_stringify(dir), Pointer_stringify(pfx));
  },
  tmpfile__deps: ['tmpnam', 'fopen'],
  tmpfile: function() {
    // FILE *tmpfile(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/tmpfile.html
    // TODO: Delete the created file on closing.
    if (_tmpfile.mode) {
      _tmpfile.mode = allocate(intArrayFromString('w+'), 'i8', ALLOC_NORMAL);
    }
    return _fopen(_tmpnam(0), _tmpfile.mode);
  },
  ungetc__deps: ['$FS'],
  ungetc: function(c, stream) {
    // int ungetc(int c, FILE *stream);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/ungetc.html
    stream = FS.getStream(stream);
    if (!stream) {
      return -1;
    }
    if (c === {{{ cDefine('EOF') }}}) {
      // do nothing for EOF character
      return c;
    }
    c = unSign(c & 0xFF);
    stream.ungotten.push(c);
    stream.eof = false;
    return c;
  },
  system__deps: ['__setErrNo', '$ERRNO_CODES'],
  system: function(command) {
    // int system(const char *command);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/system.html
    // Can't call external programs.
    ___setErrNo(ERRNO_CODES.EAGAIN);
    return -1;
  },
  fscanf__deps: ['$FS', '_scanString', 'fgetc', 'ungetc'],
  fscanf: function(stream, format, varargs) {
    // int fscanf(FILE *restrict stream, const char *restrict format, ... );
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/scanf.html
    var streamObj = FS.getStream(stream);
    if (!streamObj) {
      return -1;
    }
    var buffer = [];
    var get = function() {
      var c = _fgetc(stream);
      buffer.push(c);
      return c;
    };
    var unget = function() {
      _ungetc(buffer.pop(), stream);
    };
    return __scanString(format, get, unget, varargs);
  },
  scanf__deps: ['fscanf'],
  scanf: function(format, varargs) {
    // int scanf(const char *restrict format, ... );
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/scanf.html
    var stdin = {{{ makeGetValue(makeGlobalUse('_stdin'), '0', 'void*') }}};
    return _fscanf(stdin, format, varargs);
  },
  sscanf__deps: ['_scanString'],
  sscanf: function(s, format, varargs) {
    // int sscanf(const char *restrict s, const char *restrict format, ... );
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/scanf.html
    var index = 0;
    var get = function() { return {{{ makeGetValue('s', 'index++', 'i8') }}}; };
    var unget = function() { index--; };
    return __scanString(format, get, unget, varargs);
  },
  snprintf__deps: ['_formatString'],
  snprintf: function(s, n, format, varargs) {
    // int snprintf(char *restrict s, size_t n, const char *restrict format, ...);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/printf.html
    var result = __formatString(format, varargs);
    var limit = (n === undefined) ? result.length
                                  : Math.min(result.length, Math.max(n - 1, 0));
    if (s < 0) {
      s = -s;
      var buf = _malloc(limit+1);
      {{{ makeSetValue('s', '0', 'buf', 'i8*') }}};
      s = buf;
    }
    for (var i = 0; i < limit; i++) {
      {{{ makeSetValue('s', 'i', 'result[i]', 'i8') }}};
    }
    if (limit < n || (n === undefined)) {{{ makeSetValue('s', 'i', '0', 'i8') }}};
    return result.length;
  },
/*
  fprintf__deps: ['fwrite', '_formatString'],
  fprintf: function(stream, format, varargs) {
    // int fprintf(FILE *restrict stream, const char *restrict format, ...);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/printf.html
    var result = __formatString(format, varargs);
    var stack = Runtime.stackSave();
    var ret = _fwrite(allocate(result, 'i8', ALLOC_STACK), 1, result.length, stream);
    Runtime.stackRestore(stack);
    return ret;
  },
  printf__deps: ['fprintf'],
  printf: function(format, varargs) {
    // int printf(const char *restrict format, ...);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/printf.html
    var stdout = {{{ makeGetValue(makeGlobalUse('_stdout'), '0', 'void*') }}};
    return _fprintf(stdout, format, varargs);
  },
*/
  sprintf__deps: ['snprintf'],
  sprintf: function(s, format, varargs) {
    // int sprintf(char *restrict s, const char *restrict format, ...);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/printf.html
    return _snprintf(s, undefined, format, varargs);
  },
  asprintf__deps: ['sprintf'],
  asprintf: function(s, format, varargs) {
    return _sprintf(-s, format, varargs);
  },
/*
#if TARGET_X86
  // va_arg is just like our varargs
  vfprintf: 'fprintf',
  vsnprintf: 'snprintf',
  vprintf: 'printf',
  vsprintf: 'sprintf',
  vasprintf: 'asprintf',
  vscanf: 'scanf',
  vfscanf: 'fscanf',
  vsscanf: 'sscanf',
#endif

#if TARGET_LE32
  // convert va_arg into varargs
  vfprintf__deps: ['fprintf'],
  vfprintf: function(s, f, va_arg) {
    return _fprintf(s, f, {{{ makeGetValue('va_arg', 0, '*') }}});
  },
  vsnprintf__deps: ['snprintf'],
  vsnprintf: function(s, n, format, va_arg) {
    return _snprintf(s, n, format, {{{ makeGetValue('va_arg', 0, '*') }}});
  },
  vprintf__deps: ['printf'],
  vprintf: function(format, va_arg) {
    return _printf(format, {{{ makeGetValue('va_arg', 0, '*') }}});
  },
  vsprintf__deps: ['sprintf'],
  vsprintf: function(s, format, va_arg) {
    return _sprintf(s, format, {{{ makeGetValue('va_arg', 0, '*') }}});
  },
  vasprintf__deps: ['asprintf'],
  vasprintf: function(s, format, va_arg) {
    return _asprintf(s, format, {{{ makeGetValue('va_arg', 0, '*') }}});
  },
  vscanf__deps: ['scanf'],
  vscanf: function(format, va_arg) {
    return _scanf(format, {{{ makeGetValue('va_arg', 0, '*') }}});
  },
  vfscanf__deps: ['fscanf'],
  vfscanf: function(s, format, va_arg) {
    return _fscanf(s, format, {{{ makeGetValue('va_arg', 0, '*') }}});
  },
  vsscanf__deps: ['sscanf'],
  vsscanf: function(s, format, va_arg) {
    return _sscanf(s, format, {{{ makeGetValue('va_arg', 0, '*') }}});
  },
#endif
*/
  fopen64: 'fopen',
  __01fopen64_: 'fopen',
  __01freopen64_: 'freopen',
  __01fseeko64_: 'fseek',
  __01ftello64_: 'ftell',
  __01tmpfile64_: 'tmpfile',
  __isoc99_fscanf: 'fscanf',
  // TODO: Check if any other aliases are needed.
  _IO_getc: 'getc',
  _IO_putc: 'putc',
  _ZNSo3putEc: 'putchar',
  _ZNSo5flushEv__deps: ['fflush', 'stdout'],
  _ZNSo5flushEv: function() {
    _fflush({{{ makeGetValue(makeGlobalUse('_stdout'), '0', 'void*') }}});
  },

  // ==========================================================================
  // sys/mman.h
  // ==========================================================================

  mmap__deps: ['$FS'],
  mmap: function(start, num, prot, flags, stream, offset) {
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
  __01mmap64_: 'mmap',

  munmap: function(start, num) {
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

  mprotect: function(addr, len, prot) {
    // int mprotect(void *addr, size_t len, int prot);
    // http://pubs.opengroup.org/onlinepubs/7908799/xsh/mprotect.html
    // Pretend to succeed
    return 0;
  },

  msync: function(addr, len, flags) {
    // int msync(void *addr, size_t len, int flags);
    // http://pubs.opengroup.org/onlinepubs/009696799/functions/msync.html
    // Pretend to succeed
    return 0;
  },

  // ==========================================================================
  // stdlib.h
  // ==========================================================================

  // tiny, fake malloc/free implementation. If the program actually uses malloc,
  // a compiled version will be used; this will only be used if the runtime
  // needs to allocate something, for which this is good enough if otherwise
  // no malloc is needed.
  malloc: function(bytes) {
    /* Over-allocate to make sure it is byte-aligned by 8.
     * This will leak memory, but this is only the dummy
     * implementation (replaced by dlmalloc normally) so
     * not an issue.
     */
#if ASSERTIONS == 2
    Runtime.warnOnce('using stub malloc (reference it from C to have the real one included)');
#endif
    var ptr = Runtime.dynamicAlloc(bytes + 8);
    return (ptr+8) & 0xFFFFFFF8;
  },
  free: function() {
#if ASSERTIONS == 2
    Runtime.warnOnce('using stub free (reference it from C to have the real one included)');
#endif
},

  calloc__deps: ['malloc'],
  calloc: function(n, s) {
    var ret = _malloc(n*s);
    _memset(ret, 0, n*s);
    return ret;
  },

  abs: 'Math.abs',
  labs: 'Math.abs',
#if USE_TYPED_ARRAYS == 2
  llabs__deps: [function() { Types.preciseI64MathUsed = 1 }],
  llabs: function(lo, hi) {
    i64Math.abs(lo, hi);
    {{{ makeStructuralReturn([makeGetTempDouble(0, 'i32'), makeGetTempDouble(1, 'i32')]) }}};
  },
#else
  llabs: function(lo, hi) {
    throw 'unsupported llabs';
  },
#endif

  exit__deps: ['_exit'],
  exit: function(status) {
    __exit(status);
  },

  _ZSt9terminatev__deps: ['exit'],
  _ZSt9terminatev: function() {
    _exit(-1234);
  },

  atexit: function(func, arg) {
    __ATEXIT__.unshift({ func: func, arg: arg });
  },
  __cxa_atexit: 'atexit',

  abort: function() {
    Module['abort']();
  },

  bsearch: function(key, base, num, size, compar) {
    var cmp = function(x, y) {
#if ASM_JS
      return Module['dynCall_iii'](compar, x, y);
#else
      return FUNCTION_TABLE[compar](x, y);
#endif
    };
    var left = 0;
    var right = num;
    var mid, test, addr;

    while (left < right) {
      mid = (left + right) >>> 1;
      addr = base + (mid * size);
      test = cmp(key, addr);
      if (test < 0) {
        right = mid;
      } else if (test > 0) {
        left = mid + 1;
      } else {
        return addr;
      }
    }

    return 0;
  },

  realloc__deps: ['memcpy'],
  realloc: function(ptr, size) {
    // Very simple, inefficient implementation - if you use a real malloc, best to use
    // a real realloc with it
    if (!size) {
      if (ptr) _free(ptr);
      return 0;
    }
    var ret = _malloc(size);
    if (ptr) {
      _memcpy(ret, ptr, size); // might be some invalid reads
      _free(ptr);
    }
    return ret;
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

  qsort__deps: ['memcpy'],
  qsort: function(base, num, size, cmp) {
    if (num == 0 || size == 0) return;
    // forward calls to the JavaScript sort method
    // first, sort the items logically
    var keys = [];
    for (var i = 0; i < num; i++) keys.push(i);
    keys.sort(function(a, b) {
#if ASM_JS
      return Module['dynCall_iii'](cmp, base+a*size, base+b*size);
#else
      return FUNCTION_TABLE[cmp](base+a*size, base+b*size);
#endif
    });
    // apply the sort
    var temp = _malloc(num*size);
    _memcpy(temp, base, num*size);
    for (var i = 0; i < num; i++) {
      if (keys[i] == i) continue; // already in place
      _memcpy(base+i*size, temp+keys[i]*size, size);
    }
    _free(temp);
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
      ENV['USER'] = 'root';
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
  getenv__deps: ['$ENV'],
  getenv: function(name) {
    // char *getenv(const char *name);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/getenv.html
    if (name === 0) return 0;
    name = Pointer_stringify(name);
    if (!ENV.hasOwnProperty(name)) return 0;

    if (_getenv.ret) _free(_getenv.ret);
    _getenv.ret = allocate(intArrayFromString(ENV[name]), 'i8', ALLOC_NORMAL);
    return _getenv.ret;
  },
  clearenv__deps: ['$ENV', '__buildEnvironment'],
  clearenv: function(name) {
    // int clearenv (void);
    // http://www.gnu.org/s/hello/manual/libc/Environment-Access.html#index-clearenv-3107
    ENV = {};
    ___buildEnvironment(ENV);
    return 0;
  },
  setenv__deps: ['$ENV', '__buildEnvironment', '$ERRNO_CODES', '__setErrNo'],
  setenv: function(envname, envval, overwrite) {
    // int setenv(const char *envname, const char *envval, int overwrite);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/setenv.html
    if (envname === 0) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    var name = Pointer_stringify(envname);
    var val = Pointer_stringify(envval);
    if (name === '' || name.indexOf('=') !== -1) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    if (ENV.hasOwnProperty(name) && !overwrite) return 0;
    ENV[name] = val;
    ___buildEnvironment(ENV);
    return 0;
  },
  unsetenv__deps: ['$ENV', '__buildEnvironment', '$ERRNO_CODES', '__setErrNo'],
  unsetenv: function(name) {
    // int unsetenv(const char *name);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/unsetenv.html
    if (name === 0) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    name = Pointer_stringify(name);
    if (name === '' || name.indexOf('=') !== -1) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    if (ENV.hasOwnProperty(name)) {
      delete ENV[name];
      ___buildEnvironment(ENV);
    }
    return 0;
  },
  putenv__deps: ['$ENV', '__buildEnvironment', '$ERRNO_CODES', '__setErrNo'],
  putenv: function(string) {
    // int putenv(char *string);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/putenv.html
    // WARNING: According to the standard (and the glibc implementation), the
    //          string is taken by reference so future changes are reflected.
    //          We copy it instead, possibly breaking some uses.
    if (string === 0) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    string = Pointer_stringify(string);
    var splitPoint = string.indexOf('=')
    if (string === '' || string.indexOf('=') === -1) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    var name = string.slice(0, splitPoint);
    var value = string.slice(splitPoint + 1);
    if (!(name in ENV) || ENV[name] !== value) {
      ENV[name] = value;
      ___buildEnvironment(ENV);
    }
    return 0;
  },

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

  realpath__deps: ['$FS', '__setErrNo'],
  realpath: function(file_name, resolved_name) {
    // char *realpath(const char *restrict file_name, char *restrict resolved_name);
    // http://pubs.opengroup.org/onlinepubs/009604499/functions/realpath.html
    var absolute = FS.analyzePath(Pointer_stringify(file_name));
    if (absolute.error) {
      ___setErrNo(absolute.error);
      return 0;
    } else {
      var size = Math.min(4095, absolute.path.length);  // PATH_MAX - 1.
      for (var i = 0; i < size; i++) {
        {{{ makeSetValue('resolved_name', 'i', 'absolute.path.charCodeAt(i)', 'i8') }}}
      }
      {{{ makeSetValue('resolved_name', 'size', '0', 'i8') }}}
      return resolved_name;
    }
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

  bcopy__deps: ['memmove'],
  bcopy: function(src, dest, num) {
    // void bcopy(const void *s1, void *s2, size_t n);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/bcopy.html
    _memmove(dest, src, num);
  },

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

  strspn: function(pstr, pset) {
    var str = pstr, set, strcurr, setcurr;
    while (1) {
      strcurr = {{{ makeGetValue('str', '0', 'i8') }}};
      if (!strcurr) return str - pstr;
      set = pset;
      while (1) {
        setcurr = {{{ makeGetValue('set', '0', 'i8') }}};
        if (!setcurr || setcurr == strcurr) break;
        set++;
      }
      if (!setcurr) return str - pstr;
      str++;
    }
  },

  strcspn: function(pstr, pset) {
    var str = pstr, set, strcurr, setcurr;
    while (1) {
      strcurr = {{{ makeGetValue('str', '0', 'i8') }}};
      if (!strcurr) return str - pstr;
      set = pset;
      while (1) {
        setcurr = {{{ makeGetValue('set', '0', 'i8') }}};
        if (!setcurr || setcurr == strcurr) break;
        set++;
      }
      if (setcurr) return str - pstr;
      str++;
    }
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

  strlwr__deps:['tolower'],
  strlwr: function(pstr){
    var i = 0;
    while(1) {
      var x = {{{ makeGetValue('pstr', 'i', 'i8') }}};
      if (x == 0) break;
      {{{ makeSetValue('pstr', 'i', '_tolower(x)', 'i8') }}};
      i++;
    }
  },

  strupr__deps:['toupper'],
  strupr: function(pstr){
    var i = 0;
    while(1) {
      var x = {{{ makeGetValue('pstr', 'i', 'i8') }}};
      if (x == 0) break;
      {{{ makeSetValue('pstr', 'i', '_toupper(x)', 'i8') }}};
      i++;
    }
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

  strncat__deps: ['strlen'],
  strncat: function(pdest, psrc, num) {
    var len = _strlen(pdest);
    var i = 0;
    while(1) {
      {{{ makeCopyValues('pdest+len+i', 'psrc+i', 1, 'i8', null, 1) }}};
      if ({{{ makeGetValue('pdest', 'len+i', 'i8') }}} == 0) break;
      i ++;
      if (i == num) {
        {{{ makeSetValue('pdest', 'len+i', 0, 'i8') }}}
        break;
      }
    }
    return pdest;
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

  memchr: function(ptr, chr, num) {
    chr = unSign(chr);
    for (var i = 0; i < num; i++) {
      if ({{{ makeGetValue('ptr', 0, 'i8') }}} == chr) return ptr;
      ptr++;
    }
    return 0;
  },

  strnlen: function(ptr, num) {
    for (var i = 0; i < num; i++) {
      if ({{{ makeGetValue('ptr', 0, 'i8') }}} == 0) return i;
      ptr++;
    }
    return num;
  },

  strstr: function(ptr1, ptr2) {
    var check = 0, start;
    do {
      if (!check) {
        start = ptr1;
        check = ptr2;
      }
      var curr1 = {{{ makeGetValue('ptr1++', 0, 'i8') }}};
      var curr2 = {{{ makeGetValue('check++', 0, 'i8') }}};
      if (curr2 == 0) return start;
      if (curr2 != curr1) {
        // rewind to one character after start, to find ez in eeez
        ptr1 = start + 1;
        check = 0;
      }
    } while (curr1);
    return 0;
  },

  strchr: function(ptr, chr) {
    ptr--;
    do {
      ptr++;
      var val = {{{ makeGetValue('ptr', 0, 'i8') }}};
      if (val == chr) return ptr;
    } while (val);
    return 0;
  },
  index: 'strchr',

  strrchr__deps: ['strlen'],
  strrchr: function(ptr, chr) {
    var ptr2 = ptr + _strlen(ptr);
    do {
      if ({{{ makeGetValue('ptr2', 0, 'i8') }}} == chr) return ptr2;
      ptr2--;
    } while (ptr2 >= ptr);
    return 0;
  },
  rindex: 'strrchr',

  strdup__deps: ['strlen'],
  strdup: function(ptr) {
    var len = _strlen(ptr);
    var newStr = _malloc(len + 1);
    {{{ makeCopyValues('newStr', 'ptr', 'len', 'null', null, 1) }}};
    {{{ makeSetValue('newStr', 'len', '0', 'i8') }}};
    return newStr;
  },

  strndup__deps: ['strdup', 'strlen'],
  strndup: function(ptr, size) {
    var len = _strlen(ptr);

    if (size >= len) {
      return _strdup(ptr);
    }

    if (size < 0) {
      size = 0;
    }

    var newStr = _malloc(size + 1);
    {{{ makeCopyValues('newStr', 'ptr', 'size', 'null', null, 1) }}};
    {{{ makeSetValue('newStr', 'size', '0', 'i8') }}};
    return newStr;
  },

  strpbrk: function(ptr1, ptr2) {
    var curr;
    var searchSet = {};
    while (1) {
      var curr = {{{ makeGetValue('ptr2++', 0, 'i8') }}};
      if (!curr) break;
      searchSet[curr] = 1;
    }
    while (1) {
      curr = {{{ makeGetValue('ptr1', 0, 'i8') }}};
      if (!curr) break;
      if (curr in searchSet) return ptr1;
      ptr1++;
    }
    return 0;
  },

  __strtok_state: 0,
  strtok__deps: ['__strtok_state', 'strtok_r'],
  strtok__postset: '___strtok_state = Runtime.staticAlloc(4);',
  strtok: function(s, delim) {
    return _strtok_r(s, delim, ___strtok_state);
  },

  // Translated from newlib; for the original source and licensing, see library_strtok_r.c
  strtok_r: function(s, delim, lasts) {
    var skip_leading_delim = 1;
    var spanp;
    var c, sc;
    var tok;


    if (s == 0 && (s = getValue(lasts, 'i8*')) == 0) {
      return 0;
    }

    cont: while (1) {
      c = getValue(s++, 'i8');
      for (spanp = delim; (sc = getValue(spanp++, 'i8')) != 0;) {
        if (c == sc) {
          if (skip_leading_delim) {
            continue cont;
          } else {
            setValue(lasts, s, 'i8*');
            setValue(s - 1, 0, 'i8');
            return s - 1;
          }
        }
      }
      break;
    }

    if (c == 0) {
      setValue(lasts, 0, 'i8*');
      return 0;
    }
    tok = s - 1;

    for (;;) {
      c = getValue(s++, 'i8');
      spanp = delim;
      do {
        if ((sc = getValue(spanp++, 'i8')) == c) {
          if (c == 0) {
            s = 0;
          } else {
            setValue(s - 1, 0, 'i8');
          }
          setValue(lasts, s, 'i8*');
          return tok;
        }
      } while (sc != 0);
    }
    abort('strtok_r error!');
  },

  strerror_r__deps: ['$ERRNO_CODES', '$ERRNO_MESSAGES', '__setErrNo'],
  strerror_r: function(errnum, strerrbuf, buflen) {
    if (errnum in ERRNO_MESSAGES) {
      if (ERRNO_MESSAGES[errnum].length > buflen - 1) {
        return ___setErrNo(ERRNO_CODES.ERANGE);
      } else {
        var msg = ERRNO_MESSAGES[errnum];
        for (var i = 0; i < msg.length; i++) {
          {{{ makeSetValue('strerrbuf', 'i', 'msg.charCodeAt(i)', 'i8') }}}
        }
        {{{ makeSetValue('strerrbuf', 'i', 0, 'i8') }}}
        return 0;
      }
    } else {
      return ___setErrNo(ERRNO_CODES.EINVAL);
    }
  },
  strerror__deps: ['strerror_r'],
  strerror: function(errnum) {
    if (!_strerror.buffer) _strerror.buffer = _malloc(256);
    _strerror_r(errnum, _strerror.buffer, 256);
    return _strerror.buffer;
  },

  // ==========================================================================
  // ctype.h
  // ==========================================================================

  isascii: function(chr) {
    return chr >= 0 && (chr & 0x80) == 0;
  },
  toascii: function(chr) {
    return chr & 0x7F;
  },
  toupper: function(chr) {
    if (chr >= {{{ charCode('a') }}} && chr <= {{{ charCode('z') }}}) {
      return chr - {{{ charCode('a') }}} + {{{ charCode('A') }}};
    } else {
      return chr;
    }
  },
  _toupper: 'toupper',

  tolower__asm: true,
  tolower__sig: 'ii',
  tolower: function(chr) {
    chr = chr|0;
    if ((chr|0) < {{{ charCode('A') }}}) return chr|0;
    if ((chr|0) > {{{ charCode('Z') }}}) return chr|0;
    return (chr - {{{ charCode('A') }}} + {{{ charCode('a') }}})|0;
  },
  _tolower: 'tolower',

  // The following functions are defined as macros in glibc.
  islower: function(chr) {
    return chr >= {{{ charCode('a') }}} && chr <= {{{ charCode('z') }}};
  },
  isupper: function(chr) {
    return chr >= {{{ charCode('A') }}} && chr <= {{{ charCode('Z') }}};
  },
  isalpha: function(chr) {
    return (chr >= {{{ charCode('a') }}} && chr <= {{{ charCode('z') }}}) ||
           (chr >= {{{ charCode('A') }}} && chr <= {{{ charCode('Z') }}});
  },
  isdigit: function(chr) {
    return chr >= {{{ charCode('0') }}} && chr <= {{{ charCode('9') }}};
  },
  isdigit_l: 'isdigit', // no locale support yet
  isxdigit: function(chr) {
    return (chr >= {{{ charCode('0') }}} && chr <= {{{ charCode('9') }}}) ||
           (chr >= {{{ charCode('a') }}} && chr <= {{{ charCode('f') }}}) ||
           (chr >= {{{ charCode('A') }}} && chr <= {{{ charCode('F') }}});
  },
  isxdigit_l: 'isxdigit', // no locale support yet
  isalnum: function(chr) {
    return (chr >= {{{ charCode('0') }}} && chr <= {{{ charCode('9') }}}) ||
           (chr >= {{{ charCode('a') }}} && chr <= {{{ charCode('z') }}}) ||
           (chr >= {{{ charCode('A') }}} && chr <= {{{ charCode('Z') }}});
  },
  ispunct: function(chr) {
    return (chr >= {{{ charCode('!') }}} && chr <= {{{ charCode('/') }}}) ||
           (chr >= {{{ charCode(':') }}} && chr <= {{{ charCode('@') }}}) ||
           (chr >= {{{ charCode('[') }}} && chr <= {{{ charCode('`') }}}) ||
           (chr >= {{{ charCode('{') }}} && chr <= {{{ charCode('~') }}});
  },
  isspace: function(chr) {
    return (chr == 32) || (chr >= 9 && chr <= 13);
  },
  isblank: function(chr) {
    return chr == {{{ charCode(' ') }}} || chr == {{{ charCode('\t') }}};
  },
  iscntrl: function(chr) {
    return (0 <= chr && chr <= 0x1F) || chr === 0x7F;
  },
  isprint: function(chr) {
    return 0x1F < chr && chr < 0x7F;
  },
  isgraph: function(chr) {
    return 0x20 < chr && chr < 0x7F;
  },
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
  uname__deps: ['__utsname_struct_layout'],
  uname: function(name) {
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
  // pwd.h
  // ==========================================================================

  // TODO: Implement.
  // http://pubs.opengroup.org/onlinepubs/009695399/basedefs/pwd.h.html
  getpwuid: function(uid) {
    return 0; // NULL
  },

  // ==========================================================================
  // time.h
  // ==========================================================================

  clock: function() {
    if (_clock.start === undefined) _clock.start = Date.now();
    return Math.floor((Date.now() - _clock.start) * ({{{ cDefine('CLOCKS_PER_SEC') }}}/1000));
  },

  time: function(ptr) {
    var ret = Math.floor(Date.now()/1000);
    if (ptr) {
      {{{ makeSetValue('ptr', 0, 'ret', 'i32') }}}
    }
    return ret;
  },

  difftime: function(time1, time0) {
    return time1 - time0;
  },

  __tm_struct_layout: Runtime.generateStructInfo([
    ['i32', 'tm_sec'],
    ['i32', 'tm_min'],
    ['i32', 'tm_hour'],
    ['i32', 'tm_mday'],
    ['i32', 'tm_mon'],
    ['i32', 'tm_year'],
    ['i32', 'tm_wday'],
    ['i32', 'tm_yday'],
    ['i32', 'tm_isdst'],
    ['i32', 'tm_gmtoff'],
    ['i32', 'tm_zone']]),
  // Statically allocated time struct.
  __tm_current: 'allocate({{{ Runtime.QUANTUM_SIZE }}}*26, "i8", ALLOC_STATIC)',
  // Statically allocated timezone strings.
  __tm_timezones: {},
  // Statically allocated time strings.
  __tm_formatted: 'allocate({{{ Runtime.QUANTUM_SIZE }}}*26, "i8", ALLOC_STATIC)',

  mktime__deps: ['__tm_struct_layout', 'tzset'],
  mktime: function(tmPtr) {
    _tzset();
    var offsets = ___tm_struct_layout;
    var year = {{{ makeGetValue('tmPtr', 'offsets.tm_year', 'i32') }}};
    var timestamp = new Date(year >= 1900 ? year : year + 1900,
                             {{{ makeGetValue('tmPtr', 'offsets.tm_mon', 'i32') }}},
                             {{{ makeGetValue('tmPtr', 'offsets.tm_mday', 'i32') }}},
                             {{{ makeGetValue('tmPtr', 'offsets.tm_hour', 'i32') }}},
                             {{{ makeGetValue('tmPtr', 'offsets.tm_min', 'i32') }}},
                             {{{ makeGetValue('tmPtr', 'offsets.tm_sec', 'i32') }}},
                             0).getTime() / 1000;
    {{{ makeSetValue('tmPtr', 'offsets.tm_wday', 'new Date(timestamp).getDay()', 'i32') }}}
    var yday = Math.round((timestamp - (new Date(year, 0, 1)).getTime()) / (1000 * 60 * 60 * 24));
    {{{ makeSetValue('tmPtr', 'offsets.tm_yday', 'yday', 'i32') }}}
    return timestamp;
  },
  timelocal: 'mktime',

  gmtime__deps: ['malloc', '__tm_struct_layout', '__tm_current', 'gmtime_r'],
  gmtime: function(time) {
    return _gmtime_r(time, ___tm_current);
  },

  gmtime_r__deps: ['__tm_struct_layout', '__tm_timezones'],
  gmtime_r: function(time, tmPtr) {
    var date = new Date({{{ makeGetValue('time', 0, 'i32') }}}*1000);
    var offsets = ___tm_struct_layout;
    {{{ makeSetValue('tmPtr', 'offsets.tm_sec', 'date.getUTCSeconds()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_min', 'date.getUTCMinutes()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_hour', 'date.getUTCHours()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_mday', 'date.getUTCDate()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_mon', 'date.getUTCMonth()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_year', 'date.getUTCFullYear()-1900', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_wday', 'date.getUTCDay()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_gmtoff', '0', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_isdst', '0', 'i32') }}}
    var start = new Date(date); // define date using UTC, start from Jan 01 00:00:00 UTC
    start.setUTCDate(1);
    start.setUTCMonth(0);
    start.setUTCHours(0);
    start.setUTCMinutes(0);
    start.setUTCSeconds(0);
    start.setUTCMilliseconds(0);
    var yday = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    {{{ makeSetValue('tmPtr', 'offsets.tm_yday', 'yday', 'i32') }}}

    var timezone = "GMT";
    if (!(timezone in ___tm_timezones)) {
      ___tm_timezones[timezone] = allocate(intArrayFromString(timezone), 'i8', ALLOC_NORMAL);
    }
    {{{ makeSetValue('tmPtr', 'offsets.tm_zone', '___tm_timezones[timezone]', 'i32') }}}

    return tmPtr;
  },
  timegm__deps: ['mktime'],
  timegm: function(tmPtr) {
    _tzset();
    var offset = {{{ makeGetValue(makeGlobalUse('__timezone'), 0, 'i32') }}};
    var daylight = {{{ makeGetValue(makeGlobalUse('__daylight'), 0, 'i32') }}};
    daylight = (daylight == 1) ? 60 * 60 : 0;
    var ret = _mktime(tmPtr) + offset - daylight;
    return ret;
  },

  localtime__deps: ['malloc', '__tm_struct_layout', '__tm_current', 'localtime_r'],
  localtime: function(time) {
    return _localtime_r(time, ___tm_current);
  },

  localtime_r__deps: ['__tm_struct_layout', '__tm_timezones', 'tzset'],
  localtime_r: function(time, tmPtr) {
    _tzset();
    var offsets = ___tm_struct_layout;
    var date = new Date({{{ makeGetValue('time', 0, 'i32') }}}*1000);
    {{{ makeSetValue('tmPtr', 'offsets.tm_sec', 'date.getSeconds()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_min', 'date.getMinutes()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_hour', 'date.getHours()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_mday', 'date.getDate()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_mon', 'date.getMonth()', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_year', 'date.getFullYear()-1900', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_wday', 'date.getDay()', 'i32') }}}

    var start = new Date(date.getFullYear(), 0, 1);
    var yday = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    {{{ makeSetValue('tmPtr', 'offsets.tm_yday', 'yday', 'i32') }}}
    {{{ makeSetValue('tmPtr', 'offsets.tm_gmtoff', 'start.getTimezoneOffset() * 60', 'i32') }}}

    var dst = Number(start.getTimezoneOffset() != date.getTimezoneOffset());
    {{{ makeSetValue('tmPtr', 'offsets.tm_isdst', 'dst', 'i32') }}}

    var timezone = 'GMT'; // XXX do not rely on browser timezone info, it is very unpredictable | date.toString().match(/\(([A-Z]+)\)/)[1];
    if (!(timezone in ___tm_timezones)) {
      ___tm_timezones[timezone] = allocate(intArrayFromString(timezone), 'i8', ALLOC_NORMAL);
    }
    {{{ makeSetValue('tmPtr', 'offsets.tm_zone', '___tm_timezones[timezone]', 'i32') }}}

    return tmPtr;
  },

  asctime__deps: ['malloc', '__tm_formatted', 'asctime_r'],
  asctime: function(tmPtr) {
    return _asctime_r(tmPtr, ___tm_formatted);
  },

  asctime_r__deps: ['__tm_formatted', 'mktime'],
  asctime_r: function(tmPtr, buf) {
    var date = new Date(_mktime(tmPtr)*1000);
    var formatted = date.toString();
    var datePart = formatted.replace(/\d{4}.*/, '').replace(/ 0/, '  ');
    var timePart = formatted.match(/\d{2}:\d{2}:\d{2}/)[0];
    formatted = datePart + timePart + ' ' + date.getFullYear() + '\n';
    formatted.split('').forEach(function(chr, index) {
      {{{ makeSetValue('buf', 'index', 'chr.charCodeAt(0)', 'i8') }}}
    });
    {{{ makeSetValue('buf', '25', '0', 'i8') }}}
    return buf;
  },

  ctime__deps: ['localtime', 'asctime'],
  ctime: function(timer) {
    return _asctime(_localtime(timer));
  },

  ctime_r__deps: ['localtime', 'asctime'],
  ctime_r: function(timer, buf) {
    return _asctime_r(_localtime_r(timer, ___tm_current), buf);
  },

  dysize: function(year) {
    var leap = ((year % 4 == 0) && ((year % 100 != 0) || (year % 400 == 0)));
    return leap ? 366 : 365;
  },

  // TODO: Initialize these to defaults on startup from system settings.
  // Note: glibc has one fewer underscore for all of these. Also used in other related functions (timegm)
  _tzname: 'allocate({{{ 2*Runtime.QUANTUM_SIZE }}}, "i32*", ALLOC_STATIC)',
  _daylight: 'allocate(1, "i32*", ALLOC_STATIC)',
  _timezone: 'allocate(1, "i32*", ALLOC_STATIC)',
  tzset__deps: ['_tzname', '_daylight', '_timezone'],
  tzset: function() {
    // TODO: Use (malleable) environment variables instead of system settings.
    if (_tzset.called) return;
    _tzset.called = true;

    {{{ makeSetValue(makeGlobalUse('__timezone'), '0', '-(new Date()).getTimezoneOffset() * 60', 'i32') }}}

    var winter = new Date(2000, 0, 1);
    var summer = new Date(2000, 6, 1);
    {{{ makeSetValue(makeGlobalUse('__daylight'), '0', 'Number(winter.getTimezoneOffset() != summer.getTimezoneOffset())', 'i32') }}}

    var winterName = 'GMT'; // XXX do not rely on browser timezone info, it is very unpredictable | winter.toString().match(/\(([A-Z]+)\)/)[1];
    var summerName = 'GMT'; // XXX do not rely on browser timezone info, it is very unpredictable | summer.toString().match(/\(([A-Z]+)\)/)[1];
    var winterNamePtr = allocate(intArrayFromString(winterName), 'i8', ALLOC_NORMAL);
    var summerNamePtr = allocate(intArrayFromString(summerName), 'i8', ALLOC_NORMAL);
    {{{ makeSetValue(makeGlobalUse('__tzname'), '0', 'winterNamePtr', 'i32') }}}
    {{{ makeSetValue(makeGlobalUse('__tzname'), Runtime.QUANTUM_SIZE, 'summerNamePtr', 'i32') }}}
  },

  stime__deps: ['$ERRNO_CODES', '__setErrNo'],
  stime: function(when) {
    ___setErrNo(ERRNO_CODES.EPERM);
    return -1;
  },

  _MONTH_DAYS_REGULAR: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
  _MONTH_DAYS_LEAP: [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],

  _isLeapYear: function(year) {
      return year%4 === 0 && (year%100 !== 0 || year%400 === 0);
  },

  _arraySum: function(array, index) {
    var sum = 0;
    for (var i = 0; i <= index; sum += array[i++]);
    return sum;
  },

  _addDays__deps: ['_isLeapYear', '_MONTH_DAYS_LEAP', '_MONTH_DAYS_REGULAR'],
  _addDays: function(date, days) {
    var newDate = new Date(date.getTime());
    while(days > 0) {
      var leap = __isLeapYear(newDate.getFullYear());
      var currentMonth = newDate.getMonth();
      var daysInCurrentMonth = (leap ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR)[currentMonth];

      if (days > daysInCurrentMonth-newDate.getDate()) {
        // we spill over to next month
        days -= (daysInCurrentMonth-newDate.getDate()+1);
        newDate.setDate(1);
        if (currentMonth < 11) {
          newDate.setMonth(currentMonth+1)
        } else {
          newDate.setMonth(0);
          newDate.setFullYear(newDate.getFullYear()+1);
        }
      } else {
        // we stay in current month 
        newDate.setDate(newDate.getDate()+days);
        return newDate;
      }
    }

    return newDate;
  },

  strftime__deps: ['__tm_struct_layout', '_isLeapYear', '_arraySum', '_addDays', '_MONTH_DAYS_REGULAR', '_MONTH_DAYS_LEAP'],
  strftime: function(s, maxsize, format, tm) {
    // size_t strftime(char *restrict s, size_t maxsize, const char *restrict format, const struct tm *restrict timeptr);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/strftime.html
    
    var date = {
      tm_sec: {{{ makeGetValue('tm', '___tm_struct_layout.tm_sec', 'i32') }}},
      tm_min: {{{ makeGetValue('tm', '___tm_struct_layout.tm_min', 'i32') }}},
      tm_hour: {{{ makeGetValue('tm', '___tm_struct_layout.tm_hour', 'i32') }}},
      tm_mday: {{{ makeGetValue('tm', '___tm_struct_layout.tm_mday', 'i32') }}},
      tm_mon: {{{ makeGetValue('tm', '___tm_struct_layout.tm_mon', 'i32') }}},
      tm_year: {{{ makeGetValue('tm', '___tm_struct_layout.tm_year', 'i32') }}},
      tm_wday: {{{ makeGetValue('tm', '___tm_struct_layout.tm_wday', 'i32') }}},
      tm_yday: {{{ makeGetValue('tm', '___tm_struct_layout.tm_yday', 'i32') }}},
      tm_isdst: {{{ makeGetValue('tm', '___tm_struct_layout.tm_isdst', 'i32') }}}
    };

    var pattern = Pointer_stringify(format);

    // expand format
    var EXPANSION_RULES_1 = {
      '%c': '%a %b %d %H:%M:%S %Y',     // Replaced by the locale's appropriate date and time representation - e.g., Mon Aug  3 14:02:01 2013
      '%D': '%m/%d/%y',                 // Equivalent to %m / %d / %y
      '%F': '%Y-%m-%d',                 // Equivalent to %Y - %m - %d
      '%h': '%b',                       // Equivalent to %b
      '%r': '%I:%M:%S %p',              // Replaced by the time in a.m. and p.m. notation
      '%R': '%H:%M',                    // Replaced by the time in 24-hour notation
      '%T': '%H:%M:%S',                 // Replaced by the time
      '%x': '%m/%d/%y',                 // Replaced by the locale's appropriate date representation
      '%X': '%H:%M:%S',                 // Replaced by the locale's appropriate date representation
    };
    for (var rule in EXPANSION_RULES_1) {
      pattern = pattern.replace(new RegExp(rule, 'g'), EXPANSION_RULES_1[rule]);
    }

    var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    var leadingSomething = function(value, digits, character) {
      var str = typeof value === 'number' ? value.toString() : (value || '');
      while (str.length < digits) {
        str = character[0]+str;
      }
      return str;
    };

    var leadingNulls = function(value, digits) {
      return leadingSomething(value, digits, '0');
    };

    var compareByDay = function(date1, date2) {
      var sgn = function(value) {
        return value < 0 ? -1 : (value > 0 ? 1 : 0);
      };

      var compare;
      if ((compare = sgn(date1.getFullYear()-date2.getFullYear())) === 0) {
        if ((compare = sgn(date1.getMonth()-date2.getMonth())) === 0) {
          compare = sgn(date1.getDate()-date2.getDate());
        }
      }
      return compare;
    };

    var getFirstWeekStartDate = function(janFourth) {
        switch (janFourth.getDay()) {
          case 0: // Sunday
            return new Date(janFourth.getFullYear()-1, 11, 29);
          case 1: // Monday
            return janFourth;
          case 2: // Tuesday
            return new Date(janFourth.getFullYear(), 0, 3);
          case 3: // Wednesday
            return new Date(janFourth.getFullYear(), 0, 2);
          case 4: // Thursday
            return new Date(janFourth.getFullYear(), 0, 1);
          case 5: // Friday
            return new Date(janFourth.getFullYear()-1, 11, 31);
          case 6: // Saturday
            return new Date(janFourth.getFullYear()-1, 11, 30);
        }
    };

    var getWeekBasedYear = function(date) {
        var thisDate = __addDays(new Date(date.tm_year+1900, 0, 1), date.tm_yday);

        var janFourthThisYear = new Date(thisDate.getFullYear(), 0, 4);
        var janFourthNextYear = new Date(thisDate.getFullYear()+1, 0, 4);

        var firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
        var firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);

        if (compareByDay(firstWeekStartThisYear, thisDate) <= 0) {
          // this date is after the start of the first week of this year
          if (compareByDay(firstWeekStartNextYear, thisDate) <= 0) {
            return thisDate.getFullYear()+1;
          } else {
            return thisDate.getFullYear();
          }
        } else { 
          return thisDate.getFullYear()-1;
        }
    };

    var EXPANSION_RULES_2 = {
      '%a': function(date) {
        return WEEKDAYS[date.tm_wday].substring(0,3);
      },
      '%A': function(date) {
        return WEEKDAYS[date.tm_wday];
      },
      '%b': function(date) {
        return MONTHS[date.tm_mon].substring(0,3);
      },
      '%B': function(date) {
        return MONTHS[date.tm_mon];
      },
      '%C': function(date) {
        var year = date.tm_year+1900;
        return leadingNulls(Math.floor(year/100),2);
      },
      '%d': function(date) {
        return leadingNulls(date.tm_mday, 2);
      },
      '%e': function(date) {
        return leadingSomething(date.tm_mday, 2, ' ');
      },
      '%g': function(date) {
        // %g, %G, and %V give values according to the ISO 8601:2000 standard week-based year. 
        // In this system, weeks begin on a Monday and week 1 of the year is the week that includes 
        // January 4th, which is also the week that includes the first Thursday of the year, and 
        // is also the first week that contains at least four days in the year. 
        // If the first Monday of January is the 2nd, 3rd, or 4th, the preceding days are part of 
        // the last week of the preceding year; thus, for Saturday 2nd January 1999, 
        // %G is replaced by 1998 and %V is replaced by 53. If December 29th, 30th, 
        // or 31st is a Monday, it and any following days are part of week 1 of the following year. 
        // Thus, for Tuesday 30th December 1997, %G is replaced by 1998 and %V is replaced by 01.
        
        return getWeekBasedYear(date).toString().substring(2);
      },
      '%G': function(date) {
        return getWeekBasedYear(date);
      },
      '%H': function(date) {
        return leadingNulls(date.tm_hour, 2);
      },
      '%I': function(date) {
        return leadingNulls(date.tm_hour < 13 ? date.tm_hour : date.tm_hour-12, 2);
      },
      '%j': function(date) {
        // Day of the year (001-366)
        return leadingNulls(date.tm_mday+__arraySum(__isLeapYear(date.tm_year+1900) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, date.tm_mon-1), 3);
      },
      '%m': function(date) {
        return leadingNulls(date.tm_mon+1, 2);
      },
      '%M': function(date) {
        return leadingNulls(date.tm_min, 2);
      },
      '%n': function() {
        return '\n';
      },
      '%p': function(date) {
        if (date.tm_hour > 0 && date.tm_hour < 13) {
          return 'AM';
        } else {
          return 'PM';
        }
      },
      '%S': function(date) {
        return leadingNulls(date.tm_sec, 2);
      },
      '%t': function() {
        return '\t';
      },
      '%u': function(date) {
        var day = new Date(date.tm_year+1900, date.tm_mon+1, date.tm_mday, 0, 0, 0, 0);
        return day.getDay() || 7;
      },
      '%U': function(date) {
        // Replaced by the week number of the year as a decimal number [00,53]. 
        // The first Sunday of January is the first day of week 1; 
        // days in the new year before this are in week 0. [ tm_year, tm_wday, tm_yday]
        var janFirst = new Date(date.tm_year+1900, 0, 1);
        var firstSunday = janFirst.getDay() === 0 ? janFirst : __addDays(janFirst, 7-janFirst.getDay());
        var endDate = new Date(date.tm_year+1900, date.tm_mon, date.tm_mday);
        
        // is target date after the first Sunday?
        if (compareByDay(firstSunday, endDate) < 0) {
          // calculate difference in days between first Sunday and endDate
          var februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth()-1)-31;
          var firstSundayUntilEndJanuary = 31-firstSunday.getDate();
          var days = firstSundayUntilEndJanuary+februaryFirstUntilEndMonth+endDate.getDate();
          return leadingNulls(Math.ceil(days/7), 2);
        }

        return compareByDay(firstSunday, janFirst) === 0 ? '01': '00';
      },
      '%V': function(date) {
        // Replaced by the week number of the year (Monday as the first day of the week) 
        // as a decimal number [01,53]. If the week containing 1 January has four 
        // or more days in the new year, then it is considered week 1. 
        // Otherwise, it is the last week of the previous year, and the next week is week 1. 
        // Both January 4th and the first Thursday of January are always in week 1. [ tm_year, tm_wday, tm_yday]
        var janFourthThisYear = new Date(date.tm_year+1900, 0, 4);
        var janFourthNextYear = new Date(date.tm_year+1901, 0, 4);

        var firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
        var firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);

        var endDate = __addDays(new Date(date.tm_year+1900, 0, 1), date.tm_yday);

        if (compareByDay(endDate, firstWeekStartThisYear) < 0) {
          // if given date is before this years first week, then it belongs to the 53rd week of last year
          return '53';
        } 

        if (compareByDay(firstWeekStartNextYear, endDate) <= 0) {
          // if given date is after next years first week, then it belongs to the 01th week of next year
          return '01';
        }

        // given date is in between CW 01..53 of this calendar year
        var daysDifference;
        if (firstWeekStartThisYear.getFullYear() < date.tm_year+1900) {
          // first CW of this year starts last year
          daysDifference = date.tm_yday+32-firstWeekStartThisYear.getDate()
        } else {
          // first CW of this year starts this year
          daysDifference = date.tm_yday+1-firstWeekStartThisYear.getDate();
        }
        return leadingNulls(Math.ceil(daysDifference/7), 2);
      },
      '%w': function(date) {
        var day = new Date(date.tm_year+1900, date.tm_mon+1, date.tm_mday, 0, 0, 0, 0);
        return day.getDay();
      },
      '%W': function(date) {
        // Replaced by the week number of the year as a decimal number [00,53]. 
        // The first Monday of January is the first day of week 1; 
        // days in the new year before this are in week 0. [ tm_year, tm_wday, tm_yday]
        var janFirst = new Date(date.tm_year, 0, 1);
        var firstMonday = janFirst.getDay() === 1 ? janFirst : __addDays(janFirst, janFirst.getDay() === 0 ? 1 : 7-janFirst.getDay()+1);
        var endDate = new Date(date.tm_year+1900, date.tm_mon, date.tm_mday);

        // is target date after the first Monday?
        if (compareByDay(firstMonday, endDate) < 0) {
          var februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth()-1)-31;
          var firstMondayUntilEndJanuary = 31-firstMonday.getDate();
          var days = firstMondayUntilEndJanuary+februaryFirstUntilEndMonth+endDate.getDate();
          return leadingNulls(Math.ceil(days/7), 2);
        }
        return compareByDay(firstMonday, janFirst) === 0 ? '01': '00';
      },
      '%y': function(date) {
        // Replaced by the last two digits of the year as a decimal number [00,99]. [ tm_year]
        return (date.tm_year+1900).toString().substring(2);
      },
      '%Y': function(date) {
        // Replaced by the year as a decimal number (for example, 1997). [ tm_year]
        return date.tm_year+1900;
      },
      '%z': function(date) {
        // Replaced by the offset from UTC in the ISO 8601:2000 standard format ( +hhmm or -hhmm ),
        // or by no characters if no timezone is determinable. 
        // For example, "-0430" means 4 hours 30 minutes behind UTC (west of Greenwich). 
        // If tm_isdst is zero, the standard time offset is used. 
        // If tm_isdst is greater than zero, the daylight savings time offset is used. 
        // If tm_isdst is negative, no characters are returned. 
        // FIXME: we cannot determine time zone (or can we?)
        return '';
      },
      '%Z': function(date) {
        // Replaced by the timezone name or abbreviation, or by no bytes if no timezone information exists. [ tm_isdst]
        // FIXME: we cannot determine time zone (or can we?)
        return '';
      },
      '%%': function() {
        return '%';
      }
    };
    for (var rule in EXPANSION_RULES_2) {
      if (pattern.indexOf(rule) >= 0) {
        pattern = pattern.replace(new RegExp(rule, 'g'), EXPANSION_RULES_2[rule](date));
      }
    }

    var bytes = intArrayFromString(pattern, false);
    if (bytes.length > maxsize) {
      return 0;
    } 

    writeArrayToMemory(bytes, s);
    return bytes.length-1;
  },
  strftime_l: 'strftime', // no locale support yet

  strptime__deps: ['__tm_struct_layout', '_isLeapYear', '_arraySum', '_addDays', '_MONTH_DAYS_REGULAR', '_MONTH_DAYS_LEAP'],
  strptime: function(buf, format, tm) {
    // char *strptime(const char *restrict buf, const char *restrict format, struct tm *restrict tm);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/strptime.html
    var pattern = Pointer_stringify(format);

    // escape special characters
    // TODO: not sure we really need to escape all of these in JS regexps
    var SPECIAL_CHARS = '\\!@#$^&*()+=-[]/{}|:<>?,.';
    for (var i=0, ii=SPECIAL_CHARS.length; i<ii; ++i) {
      pattern = pattern.replace(new RegExp('\\'+SPECIAL_CHARS[i], 'g'), '\\'+SPECIAL_CHARS[i]);
    }

    // reduce number of matchers
    var EQUIVALENT_MATCHERS = {
      '%A':  '%a',
      '%B':  '%b',
      '%c':  '%x\\s+%X',
      '%D':  '%m\\/%d\\/%y',
      '%e':  '%d',
      '%h':  '%b',
      '%R':  '%H\\:%M',
      '%r':  '%I\\:%M\\:%S\\s%p',
      '%T':  '%H\\:%M\\:%S',
      '%x':  '%m\\/%d\\/(?:%y|%Y)',
      '%X':  '%H\\:%M\\:%S'
    };
    for (var matcher in EQUIVALENT_MATCHERS) {
      pattern = pattern.replace(matcher, EQUIVALENT_MATCHERS[matcher]);
    }
    
    // TODO: take care of locale

    var DATE_PATTERNS = {
      /* weeday name */     '%a': '(?:Sun(?:day)?)|(?:Mon(?:day)?)|(?:Tue(?:sday)?)|(?:Wed(?:nesday)?)|(?:Thu(?:rsday)?)|(?:Fri(?:day)?)|(?:Sat(?:urday)?)',
      /* month name */      '%b': '(?:Jan(?:uary)?)|(?:Feb(?:ruary)?)|(?:Mar(?:ch)?)|(?:Apr(?:il)?)|May|(?:Jun(?:e)?)|(?:Jul(?:y)?)|(?:Aug(?:ust)?)|(?:Sep(?:tember)?)|(?:Oct(?:ober)?)|(?:Nov(?:ember)?)|(?:Dec(?:ember)?)',
      /* century */         '%C': '\\d\\d',
      /* day of month */    '%d': '0[1-9]|[1-9](?!\\d)|1\\d|2\\d|30|31',
      /* hour (24hr) */     '%H': '\\d(?!\\d)|[0,1]\\d|20|21|22|23',
      /* hour (12hr) */     '%I': '\\d(?!\\d)|0\\d|10|11|12',
      /* day of year */     '%j': '00[1-9]|0?[1-9](?!\\d)|0?[1-9]\\d(?!\\d)|[1,2]\\d\\d|3[0-6]\\d',
      /* month */           '%m': '0[1-9]|[1-9](?!\\d)|10|11|12',
      /* minutes */         '%M': '0\\d|\\d(?!\\d)|[1-5]\\d',
      /* whitespace */      '%n': '\\s',
      /* AM/PM */           '%p': 'AM|am|PM|pm|A\\.M\\.|a\\.m\\.|P\\.M\\.|p\\.m\\.',
      /* seconds */         '%S': '0\\d|\\d(?!\\d)|[1-5]\\d|60',
      /* week number */     '%U': '0\\d|\\d(?!\\d)|[1-4]\\d|50|51|52|53',
      /* week number */     '%W': '0\\d|\\d(?!\\d)|[1-4]\\d|50|51|52|53',
      /* weekday number */  '%w': '[0-6]',
      /* 2-digit year */    '%y': '\\d\\d',
      /* 4-digit year */    '%Y': '\\d\\d\\d\\d',
      /* % */               '%%': '%',
      /* whitespace */      '%t': '\\s',
    };

    var MONTH_NUMBERS = {JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11};
    var DAY_NUMBERS_SUN_FIRST = {SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6};
    var DAY_NUMBERS_MON_FIRST = {MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6};

    for (var datePattern in DATE_PATTERNS) {
      pattern = pattern.replace(datePattern, '('+datePattern+DATE_PATTERNS[datePattern]+')');    
    }

    // take care of capturing groups
    var capture = [];
    for (var i=pattern.indexOf('%'); i>=0; i=pattern.indexOf('%')) {
      capture.push(pattern[i+1]);
      pattern = pattern.replace(new RegExp('\\%'+pattern[i+1], 'g'), '');
    }

    var matches = new RegExp('^'+pattern).exec(Pointer_stringify(buf))
    // Module['print'](Pointer_stringify(buf)+ ' is matched by '+((new RegExp('^'+pattern)).source)+' into: '+JSON.stringify(matches));

    var initDate = function() {
      var fixup = function(value, min, max) {
        return (typeof value !== 'number' || isNaN(value)) ? min : (value>=min ? (value<=max ? value: max): min);
      };
      return {
        year: fixup({{{ makeGetValue('tm', '___tm_struct_layout.tm_year', 'i32', 0, 0, 1) }}} + 1900 , 1970, 9999),
        month: fixup({{{ makeGetValue('tm', '___tm_struct_layout.tm_mon', 'i32', 0, 0, 1) }}}, 0, 11),
        day: fixup({{{ makeGetValue('tm', '___tm_struct_layout.tm_mday', 'i32', 0, 0, 1) }}}, 1, 31),
        hour: fixup({{{ makeGetValue('tm', '___tm_struct_layout.tm_hour', 'i32', 0, 0, 1) }}}, 0, 23),
        min: fixup({{{ makeGetValue('tm', '___tm_struct_layout.tm_min', 'i32', 0, 0, 1) }}}, 0, 59),
        sec: fixup({{{ makeGetValue('tm', '___tm_struct_layout.tm_sec', 'i32', 0, 0, 1) }}}, 0, 59)
      };
    };

    if (matches) {
      var date = initDate();
      var value;

      var getMatch = function(symbol) {
        var pos = capture.indexOf(symbol);
        // check if symbol appears in regexp
        if (pos >= 0) {
          // return matched value or null (falsy!) for non-matches
          return matches[pos+1];
        }
        return;
      }

      // seconds
      if ((value=getMatch('S'))) {
        date.sec = parseInt(value);
      }

      // minutes
      if ((value=getMatch('M'))) {
        date.min = parseInt(value);
      }

      // hours
      if ((value=getMatch('H'))) {
        // 24h clock
        date.hour = parseInt(value);
      } else if ((value = getMatch('I'))) {
        // AM/PM clock
        var hour = parseInt(value);
        if ((value=getMatch('p'))) {
          hour += value.toUpperCase()[0] === 'P' ? 12 : 0;
        }
        date.hour = hour;
      }

      // year
      if ((value=getMatch('Y'))) {
        // parse from four-digit year
        date.year = parseInt(value);
      } else if ((value=getMatch('y'))) {
        // parse from two-digit year...
        var year = parseInt(value);
        if ((value=getMatch('C'))) {
          // ...and century
          year += parseInt(value)*100;
        } else {
          // ...and rule-of-thumb
          year += year<69 ? 2000 : 1900;
        }
        date.year = year;
      }

      // month
      if ((value=getMatch('m'))) {
        // parse from month number
        date.month = parseInt(value)-1;
      } else if ((value=getMatch('b'))) {
        // parse from month name
        date.month = MONTH_NUMBERS[value.substring(0,3).toUpperCase()] || 0;
        // TODO: derive month from day in year+year, week number+day of week+year 
      }

      // day
      if ((value=getMatch('d'))) {
        // get day of month directly
        date.day = parseInt(value);
      } else if ((value=getMatch('j'))) {
        // get day of month from day of year ...
        var day = parseInt(value);
        var leapYear = __isLeapYear(date.year);
        for (var month=0; month<12; ++month) {
          var daysUntilMonth = __arraySum(leapYear ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, month-1);
          if (day<=daysUntilMonth+(leapYear ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR)[month]) {
            date.day = day-daysUntilMonth;
          }
        }
      } else if ((value=getMatch('a'))) {
        // get day of month from weekday ...
        var weekDay = value.substring(0,3).toUpperCase();
        if ((value=getMatch('U'))) {
          // ... and week number (Sunday being first day of week)
          // Week number of the year (Sunday as the first day of the week) as a decimal number [00,53]. 
          // All days in a new year preceding the first Sunday are considered to be in week 0.
          var weekDayNumber = DAY_NUMBERS_SUN_FIRST[weekDay];
          var weekNumber = parseInt(value);

          // January 1st 
          var janFirst = new Date(date.year, 0, 1);
          var endDate;
          if (janFirst.getDay() === 0) {
            // Jan 1st is a Sunday, and, hence in the 1st CW
            endDate = __addDays(janFirst, weekDayNumber+7*(weekNumber-1));
          } else {
            // Jan 1st is not a Sunday, and, hence still in the 0th CW
            endDate = __addDays(janFirst, 7-janFirst.getDay()+weekDayNumber+7*(weekNumber-1));
          }
          date.day = endDate.getDate();
          date.month = endDate.getMonth();
        } else if ((value=getMatch('W'))) {
          // ... and week number (Monday being first day of week)
          // Week number of the year (Monday as the first day of the week) as a decimal number [00,53]. 
          // All days in a new year preceding the first Monday are considered to be in week 0.
          var weekDayNumber = DAY_NUMBERS_MON_FIRST[weekDay];
          var weekNumber = parseInt(value);

          // January 1st 
          var janFirst = new Date(date.year, 0, 1);
          var endDate;
          if (janFirst.getDay()===1) {
            // Jan 1st is a Monday, and, hence in the 1st CW
             endDate = __addDays(janFirst, weekDayNumber+7*(weekNumber-1));
          } else {
            // Jan 1st is not a Monday, and, hence still in the 0th CW
            endDate = __addDays(janFirst, 7-janFirst.getDay()+1+weekDayNumber+7*(weekNumber-1));
          }

          date.day = endDate.getDate();
          date.month = endDate.getMonth();
        }
      }

      /*
      tm_sec  int seconds after the minute  0-61*
      tm_min  int minutes after the hour  0-59
      tm_hour int hours since midnight  0-23
      tm_mday int day of the month  1-31
      tm_mon  int months since January  0-11
      tm_year int years since 1900  
      tm_wday int days since Sunday 0-6
      tm_yday int days since January 1  0-365
      tm_isdst  int Daylight Saving Time flag 
      */

      var fullDate = new Date(date.year, date.month, date.day, date.hour, date.min, date.sec, 0);
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_sec', 'fullDate.getSeconds()', 'i32') }}}
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_min', 'fullDate.getMinutes()', 'i32') }}}
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_hour', 'fullDate.getHours()', 'i32') }}}
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_mday', 'fullDate.getDate()', 'i32') }}}
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_mon', 'fullDate.getMonth()', 'i32') }}}
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_year', 'fullDate.getFullYear()-1900', 'i32') }}}
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_wday', 'fullDate.getDay()', 'i32') }}}
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_yday', '__arraySum(__isLeapYear(fullDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, fullDate.getMonth()-1)+fullDate.getDate()-1', 'i32') }}}
      {{{ makeSetValue('tm', '___tm_struct_layout.tm_isdst', '0', 'i32') }}}

      // we need to convert the matched sequence into an integer array to take care of UTF-8 characters > 0x7F
      // TODO: not sure that intArrayFromString handles all unicode characters correctly
      return buf+intArrayFromString(matches[0]).length-1;
    } 

    return 0;
  },
  strptime_l: 'strptime', // no locale support yet

  getdate: function(string) {
    // struct tm *getdate(const char *string);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/getdate.html
    // TODO: Implement.
    return 0;
  },

  setitimer: function() { throw 'setitimer not implemented yet' },
  getitimer: function() { throw 'getitimer not implemented yet' },

  // ==========================================================================
  // sys/time.h
  // ==========================================================================

  __timespec_struct_layout: Runtime.generateStructInfo([
    ['i32', 'tv_sec'],
    ['i32', 'tv_nsec']]),
  nanosleep__deps: ['usleep', '__timespec_struct_layout'],
  nanosleep: function(rqtp, rmtp) {
    // int nanosleep(const struct timespec  *rqtp, struct timespec *rmtp);
    var seconds = {{{ makeGetValue('rqtp', '___timespec_struct_layout.tv_sec', 'i32') }}};
    var nanoseconds = {{{ makeGetValue('rqtp', '___timespec_struct_layout.tv_nsec', 'i32') }}};
    {{{ makeSetValue('rmtp', '___timespec_struct_layout.tv_sec', '0', 'i32') }}}
    {{{ makeSetValue('rmtp', '___timespec_struct_layout.tv_nsec', '0', 'i32') }}}
    return _usleep((seconds * 1e6) + (nanoseconds / 1000));
  },
  // TODO: Implement these for real.
  clock_gettime__deps: ['__timespec_struct_layout'],
  clock_gettime: function(clk_id, tp) {
    // int clock_gettime(clockid_t clk_id, struct timespec *tp);
    var now = Date.now();
    {{{ makeSetValue('tp', '___timespec_struct_layout.tv_sec', 'Math.floor(now/1000)', 'i32') }}}; // seconds
    {{{ makeSetValue('tp', '___timespec_struct_layout.tv_nsec', '0', 'i32') }}}; // nanoseconds - not supported
    return 0;
  },
  clock_settime: function(clk_id, tp) {
    // int clock_settime(clockid_t clk_id, const struct timespec *tp);
    // Nothing.
    return 0;
  },
  clock_getres__deps: ['__timespec_struct_layout'],
  clock_getres: function(clk_id, res) {
    // int clock_getres(clockid_t clk_id, struct timespec *res);
    {{{ makeSetValue('res', '___timespec_struct_layout.tv_sec', '1', 'i32') }}}
    {{{ makeSetValue('res', '___timespec_struct_layout.tv_nsec', '0', 'i32') }}}
    return 0;
  },

  // http://pubs.opengroup.org/onlinepubs/000095399/basedefs/sys/time.h.html
  gettimeofday: function(ptr) {
    // %struct.timeval = type { i32, i32 }
    {{{ (LibraryManager.structs.gettimeofday = Runtime.calculateStructAlignment({ fields: ['i32', 'i32'] }), null) }}}
    var now = Date.now();
    {{{ makeSetValue('ptr', LibraryManager.structs.gettimeofday[0], 'Math.floor(now/1000)', 'i32') }}}; // seconds
    {{{ makeSetValue('ptr', LibraryManager.structs.gettimeofday[1], 'Math.floor((now-1000*Math.floor(now/1000))*1000)', 'i32') }}}; // microseconds
    return 0;
  },

  // ==========================================================================
  // sys/timeb.h
  // ==========================================================================

  __timeb_struct_layout: Runtime.generateStructInfo([
    ['i32', 'time'],
    ['i16', 'millitm'],
    ['i16', 'timezone'],
    ['i16', 'dstflag']
  ]),
  ftime__deps: ['__timeb_struct_layout'],
  ftime: function(p) {
    var millis = Date.now();
    {{{ makeSetValue('p', '___timeb_struct_layout.time', 'Math.floor(millis/1000)', 'i32') }}};
    {{{ makeSetValue('p', '___timeb_struct_layout.millitm', 'millis % 1000', 'i16') }}};
    {{{ makeSetValue('p', '___timeb_struct_layout.timezone', '0', 'i16') }}}; // TODO
    {{{ makeSetValue('p', '___timeb_struct_layout.dstflag', '0', 'i16') }}}; // TODO
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
  times__deps: ['__tms_struct_layout', 'memset'],
  times: function(buffer) {
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
  // signal.h
  // ==========================================================================

  signal: function(sig, func) {
    // TODO
    return 0;
  },
  sigemptyset: function(set) {
    // int sigemptyset(sigset_t *set);
    {{{ makeSetValue('set', '0', '0', 'i32') }}};
    return 0;
  },
  sigfillset: function(set) {
    {{{ makeSetValue('set', '0', '-1>>>0', 'i32') }}};
    return 0;
  },
  sigaddset: function(set, signum) {
    {{{ makeSetValue('set', '0', makeGetValue('set', '0', 'i32') + '| (1 << (signum-1))', 'i32') }}};
    return 0;
  },
  sigdelset: function(set, signum) {
    {{{ makeSetValue('set', '0', makeGetValue('set', '0', 'i32') + '& (~(1 << (signum-1)))', 'i32') }}};
    return 0;
  },
  sigismember: function(set, signum) {
    return {{{ makeGetValue('set', '0', 'i32') }}} & (1 << (signum-1));
  },
  sigaction: function(set) {
    // TODO:
    return 0;
  },
  sigprocmask: 'sigaction',
  __libc_current_sigrtmin: function() {
    return 0;
  },
  __libc_current_sigrtmax: function() {
    return 0;
  },
  kill__deps: ['$ERRNO_CODES', '__setErrNo'],
  kill: function(pid, sig) {
    // int kill(pid_t pid, int sig);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/kill.html
    // Makes no sense in a single-process environment.
    ___setErrNo(ERRNO_CODES.EPERM);
    return -1;
  },
  killpg: 'kill',

  siginterrupt: function() { throw 'siginterrupt not implemented' },

  // ==========================================================================
  // sys/wait.h
  // ==========================================================================

  wait__deps: ['$ERRNO_CODES', '__setErrNo'],
  wait: function(stat_loc) {
    // pid_t wait(int *stat_loc);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/wait.html
    // Makes no sense in a single-process environment.
    ___setErrNo(ERRNO_CODES.ECHILD);
    return -1;
  },
  // NOTE: These aren't really the same, but we use the same stub for them all.
  waitid: 'wait',
  waitpid: 'wait',
  wait3: 'wait',
  wait4: 'wait',

  // ==========================================================================
  // locale.h
  // ==========================================================================

  newlocale: function(mask, locale, base) {
    return 0;
  },

  freelocale: function(locale) {},

  uselocale: function(locale) {
    return 0;
  },

  setlocale: function(category, locale) {
    if (!_setlocale.ret) _setlocale.ret = allocate([0], 'i8', ALLOC_NORMAL);
    return _setlocale.ret;
  },

  localeconv: function() {
    // %struct.timeval = type { char* decimal point, other stuff... }
    // var indexes = Runtime.calculateStructAlignment({ fields: ['i32', 'i32'] });
    var me = _localeconv;
    if (!me.ret) {
      me.ret = allocate([allocate(intArrayFromString('.'), 'i8', ALLOC_NORMAL)], 'i8*', ALLOC_NORMAL); // just decimal point, for now
    }
    return me.ret;
  },

  __locale_mb_cur_max: function() { throw '__locale_mb_cur_max not implemented' },

  // ==========================================================================
  // langinfo.h
  // ==========================================================================

  nl_langinfo: function(item) {
    // char *nl_langinfo(nl_item item);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/nl_langinfo.html
    var result;
    switch (item) {
      case {{{ cDefine('CODESET') }}}:
        result = 'ANSI_X3.4-1968';
        break;
      case {{{ cDefine('D_T_FMT') }}}:
        result = '%a %b %e %H:%M:%S %Y';
        break;
      case {{{ cDefine('D_FMT') }}}:
        result = '%m/%d/%y';
        break;
      case {{{ cDefine('T_FMT') }}}:
        result = '%H:%M:%S';
        break;
      case {{{ cDefine('T_FMT_AMPM') }}}:
        result = '%I:%M:%S %p';
        break;
      case {{{ cDefine('AM_STR') }}}:
        result = 'AM';
        break;
      case {{{ cDefine('PM_STR') }}}:
        result = 'PM';
        break;
      case {{{ cDefine('DAY_1') }}}:
        result = 'Sunday';
        break;
      case {{{ cDefine('DAY_2') }}}:
        result = 'Monday';
        break;
      case {{{ cDefine('DAY_3') }}}:
        result = 'Tuesday';
        break;
      case {{{ cDefine('DAY_4') }}}:
        result = 'Wednesday';
        break;
      case {{{ cDefine('DAY_5') }}}:
        result = 'Thursday';
        break;
      case {{{ cDefine('DAY_6') }}}:
        result = 'Friday';
        break;
      case {{{ cDefine('DAY_7') }}}:
        result = 'Saturday';
        break;
      case {{{ cDefine('ABDAY_1') }}}:
        result = 'Sun';
        break;
      case {{{ cDefine('ABDAY_2') }}}:
        result = 'Mon';
        break;
      case {{{ cDefine('ABDAY_3') }}}:
        result = 'Tue';
        break;
      case {{{ cDefine('ABDAY_4') }}}:
        result = 'Wed';
        break;
      case {{{ cDefine('ABDAY_5') }}}:
        result = 'Thu';
        break;
      case {{{ cDefine('ABDAY_6') }}}:
        result = 'Fri';
        break;
      case {{{ cDefine('ABDAY_7') }}}:
        result = 'Sat';
        break;
      case {{{ cDefine('MON_1') }}}:
        result = 'January';
        break;
      case {{{ cDefine('MON_2') }}}:
        result = 'February';
        break;
      case {{{ cDefine('MON_3') }}}:
        result = 'March';
        break;
      case {{{ cDefine('MON_4') }}}:
        result = 'April';
        break;
      case {{{ cDefine('MON_5') }}}:
        result = 'May';
        break;
      case {{{ cDefine('MON_6') }}}:
        result = 'June';
        break;
      case {{{ cDefine('MON_7') }}}:
        result = 'July';
        break;
      case {{{ cDefine('MON_8') }}}:
        result = 'August';
        break;
      case {{{ cDefine('MON_9') }}}:
        result = 'September';
        break;
      case {{{ cDefine('MON_10') }}}:
        result = 'October';
        break;
      case {{{ cDefine('MON_11') }}}:
        result = 'November';
        break;
      case {{{ cDefine('MON_12') }}}:
        result = 'December';
        break;
      case {{{ cDefine('ABMON_1') }}}:
        result = 'Jan';
        break;
      case {{{ cDefine('ABMON_2') }}}:
        result = 'Feb';
        break;
      case {{{ cDefine('ABMON_3') }}}:
        result = 'Mar';
        break;
      case {{{ cDefine('ABMON_4') }}}:
        result = 'Apr';
        break;
      case {{{ cDefine('ABMON_5') }}}:
        result = 'May';
        break;
      case {{{ cDefine('ABMON_6') }}}:
        result = 'Jun';
        break;
      case {{{ cDefine('ABMON_7') }}}:
        result = 'Jul';
        break;
      case {{{ cDefine('ABMON_8') }}}:
        result = 'Aug';
        break;
      case {{{ cDefine('ABMON_9') }}}:
        result = 'Sep';
        break;
      case {{{ cDefine('ABMON_10') }}}:
        result = 'Oct';
        break;
      case {{{ cDefine('ABMON_11') }}}:
        result = 'Nov';
        break;
      case {{{ cDefine('ABMON_12') }}}:
        result = 'Dec';
        break;
      case {{{ cDefine('ALT_DIGITS') }}}:
        result = '';
        break;
      case {{{ cDefine('RADIXCHAR') }}}:
        result = '.';
        break;
      case {{{ cDefine('THOUSEP') }}}:
        result = '';
        break;
      case {{{ cDefine('YESEXPR') }}}:
        result = '^[yY]';
        break;
      case {{{ cDefine('NOEXPR') }}}:
        result = '^[nN]';
        break;
      case {{{ cDefine('CRNCYSTR') }}}:
        result = '-';
        break;
      case {{{ cDefine('ERA') }}}:
      case {{{ cDefine('ERA_D_FMT') }}}:
      case {{{ cDefine('ERA_D_T_FMT') }}}:
      case {{{ cDefine('ERA_T_FMT') }}}:
      default:
        result = '';
        break;
    }

    var me = _nl_langinfo;
    if (!me.ret) me.ret = _malloc(32);
    for (var i = 0; i < result.length; i++) {
      {{{ makeSetValue('me.ret', 'i', 'result.charCodeAt(i)', 'i8') }}}
    }
    {{{ makeSetValue('me.ret', 'i', '0', 'i8') }}}
    return me.ret;
  },

  _Z7catopenPKci: function() { throw 'catopen not implemented' },
  _Z7catgetsP8_nl_catdiiPKc: function() { throw 'catgets not implemented' },
  _Z8catcloseP8_nl_catd: function() { throw 'catclose not implemented' },

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
  // sys/resource.h
  // ==========================================================================

  // TODO: Implement for real.
  __rlimit_struct_layout: Runtime.generateStructInfo([
    ['i32', 'rlim_cur'],
    ['i32', 'rlim_max']]),
  getrlimit__deps: ['__rlimit_struct_layout'],
  getrlimit: function(resource, rlp) {
    // int getrlimit(int resource, struct rlimit *rlp);
    {{{ makeSetValue('rlp', '___rlimit_struct_layout.rlim_cur', '-1', 'i32') }}}  // RLIM_INFINITY
    {{{ makeSetValue('rlp', '___rlimit_struct_layout.rlim_max', '-1', 'i32') }}}  // RLIM_INFINITY
    return 0;
  },
  setrlimit: function(resource, rlp) {
    // int setrlimit(int resource, const struct rlimit *rlp)
    return 0;
  },
  __01getrlimit64_: 'getrlimit',

  // TODO: Implement for real. We just do time used, and no useful data
  __rusage_struct_layout: Runtime.generateStructInfo([
    ['i64', 'ru_utime'],
    ['i64', 'ru_stime'],
    ['i32', 'ru_maxrss'],
    ['i32', 'ru_ixrss'],
    ['i32', 'ru_idrss'],
    ['i32', 'ru_isrss'],
    ['i32', 'ru_minflt'],
    ['i32', 'ru_majflt'],
    ['i32', 'ru_nswap'],
    ['i32', 'ru_inblock'],
    ['i32', 'ru_oublock'],
    ['i32', 'ru_msgsnd'],
    ['i32', 'ru_msgrcv'],
    ['i32', 'ru_nsignals'],
    ['i32', 'ru_nvcsw'],
    ['i32', 'ru_nivcsw']]),
  getrusage__deps: ['__rusage_struct_layout'],
  getrusage: function(resource, rlp) {
    // %struct.timeval = type { i32, i32 }
    var timeval = Runtime.calculateStructAlignment({ fields: ['i32', 'i32'] });

    // int getrusage(int resource, struct rusage *rlp);
    {{{ makeSetValue('rlp', '___rusage_struct_layout.ru_utime+timeval[0]', '1', 'i32') }}}
    {{{ makeSetValue('rlp', '___rusage_struct_layout.ru_utime+timeval[1]', '2', 'i32') }}}
    {{{ makeSetValue('rlp', '___rusage_struct_layout.ru_stime+timeval[0]', '3', 'i32') }}}
    {{{ makeSetValue('rlp', '___rusage_struct_layout.ru_stime+timeval[1]', '4', 'i32') }}}
    return 0;
  },

  // ==========================================================================
  // sched.h (stubs only - no thread support yet!)
  // ==========================================================================
  sched_yield: function() {
    return 0;
  },

  // ==========================================================================
  // pthread.h (stubs for mutexes only - no thread support yet!)
  // ==========================================================================

  pthread_mutex_init: function() {},
  pthread_mutex_destroy: function() {},
  pthread_mutexattr_init: function() {},
  pthread_mutexattr_settype: function() {},
  pthread_mutexattr_destroy: function() {},
  pthread_mutex_lock: function() {},
  pthread_mutex_unlock: function() {},
  pthread_mutex_trylock: function() {
    return 0;
  },
  pthread_cond_init: function() {},
  pthread_cond_destroy: function() {},
  pthread_cond_broadcast: function() {
    return 0;
  },
  pthread_cond_wait: function() {
    return 0;
  },
  pthread_cond_timedwait: function() {
    return 0;
  },
  pthread_self: function() {
    //FIXME: assumes only a single thread
    return 0;
  },
  pthread_attr_init: function(attr) {
    /* int pthread_attr_init(pthread_attr_t *attr); */
    //FIXME: should allocate a pthread_attr_t
    return 0;
  },
  pthread_getattr_np: function(thread, attr) {
    /* int pthread_getattr_np(pthread_t thread, pthread_attr_t *attr); */
    //FIXME: should fill in attributes of the given thread in pthread_attr_t
    return 0;
  },
  pthread_attr_destroy: function(attr) {
    /* int pthread_attr_destroy(pthread_attr_t *attr); */
    //FIXME: should destroy the pthread_attr_t struct
    return 0;
  },
  pthread_attr_getstack: function(attr, stackaddr, stacksize) {
    /* int pthread_attr_getstack(const pthread_attr_t *restrict attr,
       void **restrict stackaddr, size_t *restrict stacksize); */
    /*FIXME: assumes that there is only one thread, and that attr is the
      current thread*/
    {{{ makeSetValue('stackaddr', '0', 'STACK_BASE', 'i8*') }}}
    {{{ makeSetValue('stacksize', '0', 'TOTAL_STACK', 'i32') }}}
    return 0;
  },

  pthread_once: function(ptr, func) {
    if (!_pthread_once.seen) _pthread_once.seen = {};
    if (ptr in _pthread_once.seen) return;
    Runtime.dynCall('v', func);
    _pthread_once.seen[ptr] = 1;
  },

  pthread_key_create: function(key, destructor) {
    if (!_pthread_key_create.keys) _pthread_key_create.keys = {};
    // values start at 0
    _pthread_key_create.keys[key] = 0;
  },

  pthread_getspecific: function(key) {
    return _pthread_key_create.keys[key] || 0;
  },

  pthread_setspecific: function(key, value) {
    _pthread_key_create.keys[key] = value;
  },

  pthread_key_delete: ['$ERRNO_CODES'],
  pthread_key_delete: function(key) {
    if (_pthread_key_create.keys[key]) {
      delete _pthread_key_create.keys[key];
      return 0;
    }
    return ERRNO_CODES.EINVAL;
  },

  pthread_cleanup_push: function(routine, arg) {
    __ATEXIT__.push({ func: function() { Runtime.dynCall('vi', routine, [arg]) } })
    _pthread_cleanup_push.level = __ATEXIT__.length;
  },

  pthread_cleanup_pop: function() {
    assert(_pthread_cleanup_push.level == __ATEXIT__.length, 'cannot pop if something else added meanwhile!');
    __ATEXIT__.pop();
    _pthread_cleanup_push.level = __ATEXIT__.length;
  },

  // ==========================================================================
  // malloc.h
  // ==========================================================================

  memalign: function(boundary, size) {
    // leaks, and even returns an invalid pointer. Horrible hack... but then, this is a deprecated function...
    var ret = Runtime.staticAlloc(size + boundary);
    return ret + boundary - (ret % boundary);
  },

  posix_memalign__deps: ['memalign'],
  posix_memalign: function(memptr, alignment, size) {
    var ptr = _memalign(alignment, size);
    {{{ makeSetValue('memptr', '0', 'ptr', 'i8*') }}}
    return 0;
  },

  // ==========================================================================
  // arpa/inet.h
  // ==========================================================================

  htonl: function(value) {
    return ((value & 0xff) << 24) + ((value & 0xff00) << 8) +
           ((value & 0xff0000) >>> 8) + ((value & 0xff000000) >>> 24);
  },
  htons: function(value) {
    return ((value & 0xff) << 8) + ((value & 0xff00) >> 8);
  },
  ntohl: 'htonl',
  ntohs: 'htons',

  // http://pubs.opengroup.org/onlinepubs/9699919799/functions/inet_ntop.html
  inet_ntop__deps: ['__setErrNo', '$ERRNO_CODES', 'inet_ntop4', 'inet_ntop6'],
  inet_ntop: function(af, src, dst, size) {
    switch (af) {
      case {{{ cDefine('AF_INET') }}}:
        return _inet_ntop4(src, dst, size);
      case {{{ cDefine('AF_INET6') }}}:
        return _inet_ntop6(src, dst, size);
      default:
        ___setErrNo(ERRNO_CODES.EAFNOSUPPORT);
        return 0;
    }
  },
  inet_pton__deps: ['__setErrNo', '$ERRNO_CODES', 'inet_pton4', 'inet_pton6'],
  inet_pton: function(af, src, dst) {
    switch (af) {
      case {{{ cDefine('AF_INET') }}}:
        return _inet_pton4(src, dst);
      case {{{ cDefine('AF_INET6') }}}:
        return _inet_pton6(src, dst);
      default:
        ___setErrNo(ERRNO_CODES.EAFNOSUPPORT);
        return -1;
    }
  },
  inet_addr: function(ptr) {
     var b = Pointer_stringify(ptr).split(".");
     if (b.length !== 4) return -1; // we return -1 for error, and otherwise a uint32. this helps inet_pton differentiate
     return (Number(b[0]) | (Number(b[1]) << 8) | (Number(b[2]) << 16) | (Number(b[3]) << 24)) >>> 0;
  },
  _inet_aton_raw: function(str) {
    var b = str.split(".");
    return (Number(b[0]) | (Number(b[1]) << 8) | (Number(b[2]) << 16) | (Number(b[3]) << 24)) >>> 0;
  },
  _inet_ntoa_raw: function(addr) {
    return (addr & 0xff) + '.' + ((addr >> 8) & 0xff) + '.' + ((addr >> 16) & 0xff) + '.' + ((addr >> 24) & 0xff)
  },
  inet_ntoa__deps: ['_inet_ntoa_raw'],
  inet_ntoa: function(in_addr) {
    if (!_inet_ntoa.buffer) {
      _inet_ntoa.buffer = _malloc(1024);
    }
    var addr = getValue(in_addr, 'i32');
    var str = __inet_ntoa_raw(addr);
    writeStringToMemory(str.substr(0, 1024), _inet_ntoa.buffer);
    return _inet_ntoa.buffer;
  },
  inet_aton__deps: ['inet_addr'],
  inet_aton: function(cp, inp) {
    var addr = _inet_addr(cp);
    setValue(inp, addr, 'i32');
    if (addr < 0) return 0;
    return 1;
  },

  inet_ntop4__deps: ['__setErrNo', '$ERRNO_CODES', '_inet_ntoa_raw'],
  inet_ntop4: function(src, dst, size) {
    var str = __inet_ntoa_raw(getValue(src, 'i32'));
    if (str.length+1 > size) {
      ___setErrNo(ERRNO_CODES.ENOSPC);
      return 0;
    }
    writeStringToMemory(str, dst);
    return dst;
  },

  inet_ntop6__deps: ['__setErrNo', '$ERRNO_CODES', 'inet_ntop6_raw'],
  inet_ntop6: function(src, dst, size) {
    var str = _inet_ntop6_raw(src);
    if (str.length+1 > size) {
      ___setErrNo(ERRNO_CODES.ENOSPC);
      return 0;
    }
    writeStringToMemory(str, dst);
    return dst;
  },
  inet_ntop6_raw__deps: ['ntohs'],
  inet_ntop6_raw: function(src) {

    //  ref:  http://www.ietf.org/rfc/rfc2373.txt - section 2.5.4
    //  Format for IPv4 compatible and mapped  128-bit IPv6 Addresses
    //  128-bits are split into eight 16-bit words
    //  stored in network byte order (big-endian)
    //  |                80 bits               | 16 |      32 bits        |
    //  +-----------------------------------------------------------------+
    //  |               10 bytes               |  2 |      4 bytes        |
    //  +--------------------------------------+--------------------------+
    //  +               5 words                |  1 |      2 words        |
    //  +--------------------------------------+--------------------------+
    //  |0000..............................0000|0000|    IPv4 ADDRESS     | (compatible)
    //  +--------------------------------------+----+---------------------+
    //  |0000..............................0000|FFFF|    IPv4 ADDRESS     | (mapped)
    //  +--------------------------------------+----+---------------------+

    var str = "";
    var word = 0;
    var longest = 0;
    var lastzero = 0;
    var zstart = 0;
    var len = 0;
    var i = 0;

    // Handle IPv4-compatible, IPv4-mapped, loopback and any/unspecified addresses

    var hasipv4 = true;
    var v4part = "";
    // check if the 10 high-order bytes are all zeros (first 5 words)
    for (i = 0; i < 10; i++) {
      if ({{{ makeGetValue('src', 'i', 'i8') }}} !== 0) { hasipv4 = false; break; }
    }

    if (hasipv4) {
      // low-order 32-bits store an IPv4 address (bytes 13 to 16) (last 2 words)
      v4part = __inet_ntoa_raw({{{ makeGetValue('src', '12', 'i32') }}});
      // IPv4-mapped IPv6 address if 16-bit value (bytes 11 and 12) == 0xFFFF (6th word)
      if ({{{ makeGetValue('src', '10', 'i16') }}} === -1) {
        str = "::ffff:";
        str += v4part;
        return str;
      }
      // IPv4-compatible IPv6 address if 16-bit value (bytes 11 and 12) == 0x0000 (6th word)
      if ({{{ makeGetValue('src', '10', 'i16') }}} === 0) {
        str = "::";
        //special case IPv6 addresses
        if(v4part === "0.0.0.0") v4part = ""; // any/unspecified address
        if(v4part === "0.0.0.1") v4part = "1";// loopback address
        str += v4part;
        return str;
      }
    }

    // Handle all other IPv6 addresses

    // first run to find the longest contiguous zero words
    for (word = 0; word < 8; word++) {
      if ({{{ makeGetValue('src', 'word*2', 'i16') }}} === 0) {
        if (word - lastzero > 1) {
          len = 0;
        }
        lastzero = word;
        len++;
      }
      if (len > longest) {
        longest = len;
        zstart = word - longest + 1;
      }
    }

    for (word = 0; word < 8; word++) {
      if (longest > 1) {
        // compress contiguous zeros - to produce "::"
        if ({{{ makeGetValue('src', 'word*2', 'i16') }}} === 0 && word >= zstart && word < (zstart + longest) ) {
          if (word === zstart) {
            str += ":";
            if (zstart === 0) str += ":"; //leading zeros case
          }
          continue;
        }
      }
      // converts 16-bit words from big-endian to little-endian before converting to hex string
      str += Number(_ntohs({{{ makeGetValue('src', 'word*2', 'i16') }}} & 0xffff)).toString(16);
      str += word < 7 ? ":" : "";
    }
    return str;
  },

  inet_pton4__deps: ['inet_addr'],
  inet_pton4: function(src, dst) {
    var ret = _inet_addr(src);
    if (ret === -1 || isNaN(ret)) return 0;
    setValue(dst, ret, 'i32');
    return 1;
  },

  inet_pton6__deps: ['inet_pton6_raw'],
  inet_pton6: function(src, dst) {
    return _inet_pton6_raw(Pointer_stringify(src), dst);
  },

  inet_pton6_raw__deps: ['htons'],
  inet_pton6_raw: function(addr, dst) {
    var words;
    var w, offset, z, i;
    /* http://home.deds.nl/~aeron/regex/ */
    var valid6regx = /^((?=.*::)(?!.*::.+::)(::)?([\dA-F]{1,4}:(:|\b)|){5}|([\dA-F]{1,4}:){6})((([\dA-F]{1,4}((?!\3)::|:\b|$))|(?!\2\3)){2}|(((2[0-4]|1\d|[1-9])?\d|25[0-5])\.?\b){4})$/i
    if (!valid6regx.test(addr)) {
      return 0;
    }
    if (addr === "::") {
      for (i=0; i < 4; i++) {{{ makeSetValue('dst', 'i*4', '0', 'i32') }}};
      return 1;
    }
    // Z placeholder to keep track of zeros when splitting the string on ":"
    if (addr.indexOf("::") === 0) {
      addr = addr.replace("::", "Z:"); // leading zeros case
    } else {
      addr = addr.replace("::", ":Z:");
    }

    if (addr.indexOf(".") > 0) {
      // parse IPv4 embedded address
      addr = addr.replace(new RegExp('[.]', 'g'), ":");
      words = addr.split(":");
      words[words.length-4] = parseInt(words[words.length-4]) + parseInt(words[words.length-3])*256;
      words[words.length-3] = parseInt(words[words.length-2]) + parseInt(words[words.length-1])*256;
      words = words.slice(0, words.length-2);
    } else {
      words = addr.split(":");
    }

    offset = 0; z = 0;
    for (w=0; w < words.length; w++) {
      if (typeof words[w] === 'string') {
        if (words[w] === 'Z') {
          // compressed zeros - write appropriate number of zero words
          for (z = 0; z < (8 - words.length+1); z++) {
            {{{ makeSetValue('dst', '(w+z)*2', '0', 'i16') }}};
          }
          offset = z-1;
        } else {
          // parse hex to field to 16-bit value and write it in network byte-order
          {{{ makeSetValue('dst', '(w+offset)*2', '_htons(parseInt(words[w],16))', 'i16') }}};
        }
      } else {
        // parsed IPv4 words
        {{{ makeSetValue('dst', '(w+offset)*2', 'words[w]', 'i16') }}};
      }
    }
    return 1;
  },

  // netinet/in.h

  _in6addr_any:
    'allocate([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], "i8", ALLOC_STATIC)',
  _in6addr_loopback:
    'allocate([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], "i8", ALLOC_STATIC)',
  _in6addr_linklocal_allnodes:
    'allocate([255,2,0,0,0,0,0,0,0,0,0,0,0,0,0,1], "i8", ALLOC_STATIC)',
  _in6addr_linklocal_allrouters:
    'allocate([255,2,0,0,0,0,0,0,0,0,0,0,0,0,0,2], "i8", ALLOC_STATIC)',
  _in6addr_interfacelocal_allnodes:
    'allocate([255,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1], "i8", ALLOC_STATIC)',
  _in6addr_interfacelocal_allrouters:
    'allocate([255,1,0,0,0,0,0,0,0,0,0,0,0,0,0,2], "i8", ALLOC_STATIC)',
  _in6addr_sitelocal_allrouters:
    'allocate([255,5,0,0,0,0,0,0,0,0,0,0,0,0,0,2], "i8", ALLOC_STATIC)',

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
  socket__deps: ['$FS', '$Sockets'],
  socket: function(family, type, protocol) {
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

  connect: function() {
    // Stub: connection-oriented sockets are not supported yet.
  },

  bind__deps: ['$FS', '$Sockets', '_inet_ntoa_raw', 'ntohs', 'mkport'],
  bind: function(fd, addr, addrlen) {
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

  sendmsg__deps: ['$FS', '$Sockets', 'bind', '_inet_ntoa_raw', 'ntohs'],
  sendmsg: function(fd, msg, flags) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    // if we are not connected, use the address info in the message
    if (!info.bound) {
      _bind(fd);
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

  recvmsg__deps: ['$FS', '$Sockets', 'bind', '__setErrNo', '$ERRNO_CODES', 'htons'],
  recvmsg: function(fd, msg, flags) {
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

  shutdown__deps: ['$FS'],
  shutdown: function(fd, how) {
    var stream = FS.getStream(fd);
    if (!stream) return -1;
    stream.close();
    FS.closeStream(stream);
  },

  ioctl__deps: ['$FS'],
  ioctl: function(fd, request, varargs) {
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

  setsockopt: function(d, level, optname, optval, optlen) {
    console.log('ignoring setsockopt command');
    return 0;
  },

  accept__deps: ['$FS'],
  accept: function(fd, addr, addrlen) {
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

  select__deps: ['$FS'],
  select: function(nfds, readfds, writefds, exceptfds, timeout) {
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
  socket__deps: ['$FS', '$Sockets'],
  socket: function(family, type, protocol) {
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

  connect__deps: ['$FS', '$Sockets', '_inet_ntoa_raw', 'ntohs', 'gethostbyname'],
  connect: function(fd, addr, addrlen) {
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

  recv__deps: ['$FS'],
  recv: function(fd, buf, len, flags) {
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

  send__deps: ['$FS'],
  send: function(fd, buf, len, flags) {
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

  sendmsg__deps: ['$FS', '$Sockets', 'connect'],
  sendmsg: function(fd, msg, flags) {
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

  recvmsg__deps: ['$FS', '$Sockets', 'connect', 'recv', '__setErrNo', '$ERRNO_CODES', 'htons'],
  recvmsg: function(fd, msg, flags) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    // if we are not connected, use the address info in the message
    if (!info.connected) {
#if SOCKET_DEBUG
    Module.print('recvmsg connecting');
#endif
      var name = {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_name', '*') }}};
      assert(name, 'sendmsg on non-connected socket, and no name/address in the message');
      _connect(fd, name, {{{ makeGetValue('msg', 'Sockets.msghdr_layout.msg_namelen', 'i32') }}});
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

  recvfrom__deps: ['$FS', 'connect', 'recv'],
  recvfrom: function(fd, buf, len, flags, addr, addrlen) {
    var info = FS.getStream(fd);
    if (!info) return -1;
    // if we are not connected, use the address info in the message
    if (!info.connected) {
      //var name = {{{ makeGetValue('addr', '0', '*') }}};
      _connect(fd, addr, addrlen);
    }
    return _recv(fd, buf, len, flags);
  },

  shutdown__deps: ['$FS'],
  shutdown: function(fd, how) {
    var stream = FS.getStream(fd);
    if (!stream) return -1;
    stream.socket.close();
    FS.closeStream(stream);
  },

  ioctl__deps: ['$FS'],
  ioctl: function(fd, request, varargs) {
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

  setsockopt: function(d, level, optname, optval, optlen) {
    console.log('ignoring setsockopt command');
    return 0;
  },

  bind__deps: ['connect'],
  bind: function(fd, addr, addrlen) {
    _connect(fd, addr, addrlen);
    return 0;
  },

  listen: function(fd, backlog) {
    return 0;
  },

  accept__deps: ['$FS', '$Sockets'],
  accept: function(fd, addr, addrlen) {
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

  select__deps: ['$FS'],
  select: function(nfds, readfds, writefds, exceptfds, timeout) {
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

  socketpair__deps: ['__setErrNo', '$ERRNO_CODES'],
  socketpair: function(domain, type, protocol, sv) {
    // int socketpair(int domain, int type, int protocol, int sv[2]);
    // http://pubs.opengroup.org/onlinepubs/009695399/functions/socketpair.html
    ___setErrNo(ERRNO_CODES.EOPNOTSUPP);
    return -1;
  },

  // pty.h

  openpty: function() { throw 'openpty: TODO' },
  forkpty: function() { throw 'forkpty: TODO' },

  // grp.h

  initgroups: function() { throw 'initgroups: TODO' },

  // pwd.h

  getpwnam: function() { throw 'getpwnam: TODO' },
  setpwent: function() { throw 'setpwent: TODO' },
  getpwent: function() { throw 'getpwent: TODO' },
  endpwent: function() { throw 'endpwent: TODO' },

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
  __syscall3: function(n, a1, a2, a3) {
//        console.log("[syscall] number = " + n);
      switch (n) {
          case 146: // SYS_writev
//              console.log("a1 = " + a1);
            if (a1 == 1) { // stdout
//              console.log("a3 = " + a3);
                var written = 0;
                for (var i = 0; i < a3; i++) {
                    var iov_len = {{{ makeGetValue('a2', '4 + 8 * i', 'i32') }}};
//                  console.log("iov_len = " + iov_len);
                    if (iov_len > 0) {
                        console.log(Pointer_stringify({{{ makeGetValue('a2', '8 * i', 'i32') }}}));
                        written += iov_len;
                    }
                }
                return written;
            }
            break;
      }
      return 0;
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

