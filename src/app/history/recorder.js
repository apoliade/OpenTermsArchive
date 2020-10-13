/**
* This file is the boundary beyond which the usage of git is abstracted.
* Commit SHAs are used as opaque unique IDs.
*/

import fsApi from 'fs';
import path from 'path';

import mime from 'mime';

import Git from './git.js';

const fs = fsApi.promises;

export default class Recorder {
  constructor({ path, fileExtension }) {
    this.path = path;
    this.fileExtension = fileExtension;
    this.git = new Git(this.path);
  }

  async record({ serviceId, documentDate, documentType, content, changelog, mimeType, relativeFilePath }) {
    const fileExtension = mime.getExtension(mimeType);
    const filePath = await this.save({ serviceId, documentType, content, fileExtension, relativeFilePath });
    const sha = await this.commit(filePath, changelog, documentDate);

    return {
      path: filePath,
      id: sha,
    };
  }

  async save({ serviceId, documentType, content, fileExtension, relativeFilePath }) {
    const directory = `${this.path}/${relativeFilePath ? path.dirname(relativeFilePath) : serviceId}`;

    if (!await fileExists(directory)) {
      await fs.mkdir(directory, { recursive: true });
    }

    const filePath = `${this.path}/${relativeFilePath}` || this.getPathFor(serviceId, documentType, fileExtension);

    await fs.writeFile(filePath, content);

    return filePath;
  }

  async commit(filePath, message, authorDate) {
    try {
      await this.git.add(filePath);
      return await this.git.commit(filePath, message, authorDate);
    } catch (error) {
      throw new Error(`Could not commit ${filePath} with message "${message}" due to error: "${error}"`);
    }
  }

  async publish() {
    return this.git.pushChanges();
  }

  async getLatestRecord(serviceId, documentType) {
    const filePathGlob = this.getPathFor(serviceId, documentType, '*');
    const { commit, filePath } = await this.git.findUnique(filePathGlob);

    if (!commit || !filePath) {
      return {};
    }

    const recordFilePath = `${this.path}/${filePath}`;
    const mimeType = mime.getType(filePath);

    const readFileOptions = {};
    if (mimeType.startsWith('text/')) {
      readFileOptions.encoding = 'utf8';
    }

    return {
      id: commit.hash,
      content: await fs.readFile(recordFilePath, readFileOptions),
      mimeType,
    };
  }

  getPathFor(serviceId, documentType, fileExtension) {
    return `${this.path}/${serviceId}/${documentType}.${fileExtension || this.fileExtension}`;
  }

  async isTracked(serviceId, documentType) {
    const filePath = this.getPathFor(serviceId, documentType, '*');
    return this.git.isTracked(filePath);
  }

  async getRecord(snapshotId) {
    await this.git.checkout(snapshotId);
    const [ commit ] = await this.git.log([ '-n', '1', '--stat=4096', snapshotId ]);
    const [ diffChanges ] = commit.diff.files;

    const relativeFilePath = diffChanges.file;
    const recordFilePath = `${this.path}/${relativeFilePath}`;
    const mimeType = mime.getType(recordFilePath);

    const readFileOptions = {};
    if (mimeType.startsWith('text/')) {
      readFileOptions.encoding = 'utf8';
    }

    return {
      id: commit.hash,
      date: commit.date,
      content: await fs.readFile(recordFilePath, readFileOptions),
      mimeType,
      relativeFilePath,
    };
  }

  async getAllRecords() {
    return this.git.log([ '-n', '101' ]);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
  }
}
