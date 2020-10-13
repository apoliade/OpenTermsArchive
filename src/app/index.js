import path from 'path';
import events from 'events';

import config from 'config';
import async from 'async';

import * as history from './history/index.js';
import fetch from './fetcher/index.js';
import filter from './filter/index.js';
import loadServiceDeclarations from './loader/index.js';
import { InaccessibleContentError } from './errors.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const SERVICE_DECLARATIONS_PATH = path.resolve(__dirname, '../../', config.get('serviceDeclarationsPath'));
const MAX_PARALLEL_DOCUMENTS_TRACKS = 20;
const MAX_PARALLEL_REFILTERS = 20;

export const AVAILABLE_EVENTS = [
  'snapshotRecorded',
  'firstSnapshotRecorded',
  'snapshotNotChanged',
  'versionRecorded',
  'firstVersionRecorded',
  'versionNotChanged',
  'recordsPublished',
  'inaccessibleContent',
  'error'
];

export default class CGUs extends events.EventEmitter {
  get serviceDeclarations() {
    return this._serviceDeclarations;
  }

  get serviceIds() {
    return Object.keys(this._serviceDeclarations);
  }

  async init() {
    if (!this._serviceDeclarations) {
      this.initQueues();
      this._serviceDeclarations = await loadServiceDeclarations(SERVICE_DECLARATIONS_PATH);
    }

    return this._serviceDeclarations;
  }

  initQueues() {
    this.trackDocumentChangesQueue = async.queue(async document => this.trackDocumentChanges(document),
      MAX_PARALLEL_DOCUMENTS_TRACKS);
    this.refilterDocumentsQueue = async.queue(async document => this.refilterAndRecordDocument(document),
      MAX_PARALLEL_REFILTERS);

    const queueErrorHandler = (error, { serviceId, type }) => {
      if (error instanceof InaccessibleContentError) {
        return this.emit('inaccessibleContent', error, serviceId, type);
      }

      this.emit('error', error, serviceId, type);

      throw error;
    };

    this.trackDocumentChangesQueue.error(queueErrorHandler);
    this.refilterDocumentsQueue.error(queueErrorHandler);
  }

  attach(listener) {
    AVAILABLE_EVENTS.forEach(event => {
      const handlerName = `on${event[0].toUpperCase()}${event.substr(1)}`;

      if (listener[handlerName]) {
        this.on(event, listener[handlerName].bind(listener));
      }
    });
  }

  async trackChanges(servicesIds) {
    this._forEachDocumentOf(servicesIds, document => this.trackDocumentChangesQueue.push(document));

    await this.trackDocumentChangesQueue.drain();
    await this.publish();
  }

  async trackDocumentChanges(documentDeclaration) {
    const { type, serviceId, fetch: location } = documentDeclaration;

    const { mimeType, content } = await fetch(location);

    if (!content) {
      return;
    }

    const snapshotId = await this.recordSnapshot({
      content,
      mimeType,
      serviceId,
      type
    });

    if (!snapshotId) {
      return;
    }

    return this.recordVersion({
      snapshotContent: content,
      mimeType,
      snapshotId,
      serviceId,
      documentDeclaration
    });
  }

  async refilterAndRecord(servicesIds) {
    this._forEachDocumentOf(servicesIds, document => this.refilterDocumentsQueue.push(document));

    await this.refilterDocumentsQueue.drain();
    await this.publish();
  }

  async refilterAndRecordDocument(documentDeclaration) {
    const { type, serviceId } = documentDeclaration;

    const { id: snapshotId, content: snapshotContent, mimeType } = await history.getLatestSnapshot(serviceId, type);

    if (!snapshotId) {
      return;
    }

    return this.recordVersion({
      snapshotContent,
      mimeType,
      snapshotId,
      serviceId,
      documentDeclaration,
      isRefiltering: true
    });
  }

  async _forEachDocumentOf(servicesIds = [], callback) {
    servicesIds.forEach(serviceId => {
      const { documents } = this._serviceDeclarations[serviceId];
      Object.keys(documents).forEach(type => {
        callback({
          serviceId,
          type,
          ...documents[type]
        });
      });
    });
  }

  async recordSnapshot({ content, mimeType, serviceId, type }) {
    const { id: snapshotId, isFirstRecord } = await history.recordSnapshot({
      serviceId,
      documentType: type,
      content,
      mimeType
    });

    if (!snapshotId) {
      return this.emit('snapshotNotChanged', serviceId, type);
    }

    this.emit(isFirstRecord ? 'firstSnapshotRecorded' : 'snapshotRecorded', serviceId, type, snapshotId);
    return snapshotId;
  }

  async recordVersion({ snapshotContent, snapshotDate, mimeType, snapshotId, serviceId, documentDeclaration, filterFunctions, isRefiltering }) {
    const { type } = documentDeclaration;
    const document = await filter({
      content: snapshotContent,
      mimeType,
      documentDeclaration,
      filterFunctions,
    });

    const recordFunction = !isRefiltering ? 'recordVersion' : 'recordRefilter';

    const { id: versionId, isFirstRecord } = await history[recordFunction]({
      serviceId,
      content: document,
      snapshotDate,
      documentType: type,
      snapshotId
    });

    if (!versionId) {
      return this.emit('versionNotChanged', serviceId, type);
    }

    this.emit(isFirstRecord ? 'firstVersionRecorded' : 'versionRecorded', serviceId, type, versionId);
  }

  async rewriteVersion() {
    const snapshotId = '31fde9a45cff00464305c97eefe1dd39b78eb24c';
    const { date: dateString, content, mimeType } = await history.getSnapshot(snapshotId);
    // getService et nom de fichier
    const date = new Date(dateString);
    const serviceDeclarationTOS = this.serviceDeclarations.ASKfm.documents['Terms of Service'];
    const availableDates = Object.keys(serviceDeclarationTOS);
    const applicableDates = availableDates.map(availableDate => new Date(availableDate));
    const applicableDate = applicableDates.sort((a, b) => b - a)
      .find(availableDate => availableDate <= date);

    const documentDeclaration = this.serviceDeclarations.ASKfm.documents['Terms of Service'][applicableDate.toISOString()];

    const filters = Object.keys(this.serviceDeclarations.ASKfm.filters).reduce((acc, filterName) => {
      const availableFiltersDates = Object.keys(this.serviceDeclarations.ASKfm.filters[filterName]);
      const applicableFiltersDates = availableFiltersDates.map(availableDate => new Date(availableDate));
      const applicableFilterDate = applicableFiltersDates.sort((a, b) => b - a)
        .find(availableDate => availableDate <= date);
      acc[filterName] = this._serviceDeclarations.ASKfm.filters[filterName][applicableFilterDate.toISOString()];
      return acc;
    }, {});

    return this.recordVersion({
      snapshotContent: content,
      mimeType,
      snapshotId,
      serviceId: 'ASKfm',
      filterFunctions: filters,
      documentDeclaration: {
        type: 'Terms of Service',
        ...documentDeclaration
      },
      snapshotDate: date,
    });
  }

  async publish() {
    if (!config.get('history.publish')) {
      return;
    }

    await history.publish();
    this.emit('recordsPublished');
  }

  // test si charger tos les commits en mémoire
  // si réécrire ça marche sans mettre 15 ans
  /* eslint-disable */
  async sortSnapshots() {
    const commits = await history.getAllSnapshots();
    const commitsSorted = commits.sort((a, b) => new Date(a.date) - new Date(b.date)).filter(commit => commit.message.includes('Update'));

    let i = 0;
    console.time('time');
    for (const commit of commitsSorted) {
      const { date: dateString, content, mimeType, relativeFilePath } = await history.getSnapshot(commit.hash);
      await history.recordSnapshot2({
        relativeFilePath,
        content,
        mimeType,
        documentDate: new Date(dateString),
        changelog: commit.message
      });
      i++;
      if (i % 100 == 0) {
        console.log(i);
        console.timeLog('time');
      }
    }
    // console.timeEnd('time');
    // load all snapshots commits
    // sort
    // prendre le contenu du fichier et ion créer un nouveau commit
    // recreate all commits one by one
  }
}
