// caption_trash_ops.js
// File mutation helpers for prune/restore and trash naming.

var CaptionTrashOps = (function() {
  var TRASH_NAME_PATTERN = /^[^_]+_[^_]+__.+$/;

  async function writeFileFromArrayBuffer(dirHandle, name, buffer) {
    var handle = await dirHandle.getFileHandle(name, { create: true });
    var writer = await handle.createWritable();
    await writer.write(buffer);
    await writer.close();
  }

  async function writeFileFromText(dirHandle, name, text) {
    var handle = await dirHandle.getFileHandle(name, { create: true });
    var writer = await handle.createWritable();
    await writer.write(text);
    await writer.close();
  }

  function makeTrashName(baseName) {
    var stamp = Date.now().toString(36);
    var rand = Math.floor(Math.random() * 0xffff).toString(16);
    return stamp + '_' + rand + '__' + baseName;
  }

  function getOriginalNameFromTrashName(name) {
    var fileName = String(name || '');
    if (!TRASH_NAME_PATTERN.test(fileName)) {
      return '';
    }
    var splitAt = fileName.indexOf('__');
    if (splitAt < 0) {
      return '';
    }
    return fileName.slice(splitAt + 2);
  }

  async function assertFileMissing(dirHandle, name) {
    try {
      await dirHandle.getFileHandle(name);
      throw new Error('Cannot restore, file already exists');
    } catch (err) {
      if (!err || err.name !== 'NotFoundError') {
        throw err;
      }
    }
  }

  async function copyFileIfVerified(sourceDir, sourceName, targetDir, targetName) {
    var sourceHandle = await sourceDir.getFileHandle(sourceName);
    var sourceFile = await sourceHandle.getFile();
    var sourceBytes = await sourceFile.arrayBuffer();

    await writeFileFromArrayBuffer(targetDir, targetName, sourceBytes);

    var targetHandle = await targetDir.getFileHandle(targetName);
    var targetFile = await targetHandle.getFile();
    if (targetFile.size !== sourceFile.size) {
      throw new Error('Restore failed verification');
    }
  }

  async function moveFileToTrash(dirHandle, trashDir, sourceName, trashName) {
    var sourceHandle = await dirHandle.getFileHandle(sourceName);
    var sourceFile = await sourceHandle.getFile();
    await writeFileFromArrayBuffer(trashDir, trashName, await sourceFile.arrayBuffer());
    await dirHandle.removeEntry(sourceName);
  }

  async function moveCaptionToTrashIfPresent(dirHandle, trashDir, sourceName, trashName) {
    try {
      var sourceHandle = await dirHandle.getFileHandle(sourceName);
      var sourceFile = await sourceHandle.getFile();
      await writeFileFromText(trashDir, trashName, await sourceFile.text());
      await dirHandle.removeEntry(sourceName);
    } catch (err) {
      if (!err || err.name !== 'NotFoundError') {
        throw err;
      }
    }
  }

  async function findMatchingTrashCaptionName(trashDirHandle, expectedCaptionName) {
    for await (var entry of trashDirHandle.values()) {
      if (entry.kind !== 'file') {
        continue;
      }
      if (getOriginalNameFromTrashName(entry.name) === expectedCaptionName) {
        return entry.name;
      }
    }
    return '';
  }

  async function backupOriginalPair(dirHandle, mediaItem, oldFile) {
    var trashDir = await dirHandle.getDirectoryHandle('.caption_trash', { create: true });

    var oldFileObj = await mediaItem.fileHandle.getFile();
    await writeFileFromArrayBuffer(trashDir, oldFile, await oldFileObj.arrayBuffer());

    var oldCaption = oldFile.replace(/\.[^.]+$/, '.txt');
    try {
      var oldCaptionHandle = await dirHandle.getFileHandle(oldCaption);
      var oldCaptionFile = await oldCaptionHandle.getFile();
      await writeFileFromText(trashDir, oldCaption, await oldCaptionFile.text());
    } catch (err) {
      if (!err || err.name !== 'NotFoundError') {
        throw err;
      }
    }
  }

  async function prunePickerMedia(mediaItem) {
    var dirHandle = mediaItem.dirHandle;
    var mediaName = mediaItem.fileName;
    var captionName = mediaName.replace(/\.[^.]+$/, '.txt');
    var trashDir = await dirHandle.getDirectoryHandle('.caption_trash', { create: true });
    var trashMediaName = makeTrashName(mediaName);
    var trashCaptionName = makeTrashName(captionName);

    await moveFileToTrash(dirHandle, trashDir, mediaName, trashMediaName);
    await moveCaptionToTrashIfPresent(dirHandle, trashDir, captionName, trashCaptionName);

    return {
      mediaName: mediaName,
      captionName: captionName,
      trashMediaName: trashMediaName,
      trashCaptionName: trashCaptionName
    };
  }

  async function restorePickerMedia(mediaItem, targetDirHandle) {
    var trashDirHandle = mediaItem.dirHandle;
    var trashMediaName = mediaItem.fileName;
    var originalMediaName = getOriginalNameFromTrashName(trashMediaName);
    if (!originalMediaName) {
      throw new Error('Cannot restore: not a pruned file');
    }

    var originalCaptionName = originalMediaName.replace(/\.[^.]+$/, '.txt');

    await assertFileMissing(targetDirHandle, originalMediaName);
    var trashCaptionName = await findMatchingTrashCaptionName(trashDirHandle, originalCaptionName);
    if (trashCaptionName) {
      await assertFileMissing(targetDirHandle, originalCaptionName);
    }

    await copyFileIfVerified(trashDirHandle, trashMediaName, targetDirHandle, originalMediaName);
    if (trashCaptionName) {
      await copyFileIfVerified(trashDirHandle, trashCaptionName, targetDirHandle, originalCaptionName);
    }

    await trashDirHandle.removeEntry(trashMediaName);
    if (trashCaptionName) {
      await trashDirHandle.removeEntry(trashCaptionName);
    }

    return {
      trashMediaName: trashMediaName,
      mediaName: originalMediaName,
      captionName: originalCaptionName
    };
  }

  return {
    backupOriginalPair: backupOriginalPair,
    makeTrashName: makeTrashName,
    getOriginalNameFromTrashName: getOriginalNameFromTrashName,
    prunePickerMedia: prunePickerMedia,
    restorePickerMedia: restorePickerMedia
  };
})();
