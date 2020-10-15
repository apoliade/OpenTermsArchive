/**
* This module is the boundary beyond which the persistence method (filesystem and git) is abstracted.
*/

import path from 'path';
import config from 'config';

import Recorder from './recorder.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export const SNAPSHOTS_PATH = path.resolve(__dirname, '../../..', config.get('history.snapshotsPath'));
export const SNAPSHOTS2_PATH = path.resolve(__dirname, '../../..', './data/snapshots2');
export const VERSIONS_PATH = path.resolve(__dirname, '../../..', config.get('history.versionsPath'));

const snapshotRecorder = new Recorder({ path: SNAPSHOTS_PATH, fileExtension: 'html' });
const snapshot2Recorder = new Recorder({ path: SNAPSHOTS2_PATH, fileExtension: 'html' });
const versionRecorder = new Recorder({ path: VERSIONS_PATH, fileExtension: 'md' });

export async function recordSnapshot({ serviceId, documentType, content, mimeType }) {
  const isFirstRecord = !await snapshotRecorder.isTracked(serviceId, documentType);
  const prefix = isFirstRecord ? 'Start tracking' : 'Update';
  const changelog = `${prefix} ${serviceId} ${documentType}`;
  const recordResult = await snapshotRecorder.record({
    serviceId,
    documentType,
    content,
    changelog,
    mimeType,
  });

  return {
    ...recordResult,
    isFirstRecord
  };
}

export async function recordSnapshot2({ relativeFilePath, documentDate, changelog, content, mimeType }) {
  const recordResult = await snapshot2Recorder.record({
    relativeFilePath,
    content,
    documentDate,
    changelog,
    mimeType,
  });

  return {
    ...recordResult,
  };
}

export async function recordVersion({ serviceId, snapshotDate, documentType, content, snapshotId }) {
  return _recordVersion({ serviceId, snapshotDate, documentType, content, snapshotId });
}

export async function recordRefilter({ serviceId, snapshotDate, documentType, content, snapshotId }) {
  return _recordVersion({ serviceId, snapshotDate, documentType, content, snapshotId, isRefiltering: true });
}

async function _recordVersion({ serviceId, snapshotDate, documentType, content, snapshotId, isRefiltering }) {
  if (!snapshotId) {
    throw new Error(`A snapshot ID is required to ensure data consistency for ${serviceId}'s ${documentType}`);
  }

  let prefix = isRefiltering ? 'Refilter' : 'Update';

  const isFirstRecord = !await versionRecorder.isTracked(serviceId, documentType);
  prefix = isFirstRecord ? 'Start tracking' : prefix;

  const changelog = `${prefix} ${serviceId} ${documentType}

This version was recorded after filtering snapshot ${config.get('history.publish') ? config.get('history.snapshotsBaseUrl') : ''}${snapshotId}`;

  const recordResult = await versionRecorder.record({
    serviceId,
    documentDate: snapshotDate,
    documentType,
    content,
    changelog
  });

  return {
    ...recordResult,
    isFirstRecord
  };
}

export async function publish() {
  return Promise.all([
    snapshotRecorder.publish(),
    versionRecorder.publish()
  ]);
}

export function getLatestSnapshot(serviceId, documentType) {
  return snapshotRecorder.getLatestRecord(serviceId, documentType);
}

export function getSnapshot(snapshotId) {
  return snapshotRecorder.getRecord(snapshotId);
}

export function getSnapshotOptimized({ hash, date, path }) {
  return snapshotRecorder.getRecordOptimized({ hash, date, path });
}

export function getAllSnapshots() {
  return snapshotRecorder.getAllRecords();
}
