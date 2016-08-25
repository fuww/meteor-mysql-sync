import {Meteor} from 'meteor/meteor';
import {_} from 'meteor/underscore';
import {Log} from 'meteor/logging';
import {moment} from 'meteor/momentjs:moment';
import LiveMySQL from 'mysql-live-select';
import MySQL from 'mysql-live-select/node_modules/mysql';
import Future from 'fibers/future';

const MIN_SERVER_ID = 1024;
const MAX_SERVER_ID = Math.pow(2, 32) - 1;
const STRATEGIES = {
  POLLING: 'polling',
  OPLOG_TAILING: 'oplog_tailing'
};

function getQuery(table, updatedAtColumn, updatedAt) {
  return function query(esc, escId) {
    let sqlQuery = `SELECT *, NOW() AS _mysql_sync_now FROM ${escId(table)}`;
    const escapedUpdatedAtColumn = escId(updatedAtColumn);

    if (updatedAt) {
      sqlQuery += ` WHERE ${escapedUpdatedAtColumn} > ${esc(updatedAt)}`;
    }
    sqlQuery += ` ORDER BY ${escapedUpdatedAtColumn} ASC`;

    return sqlQuery;
  };
}

const DEFAULT_OPTIONS = {
  updatedAtColumn: 'updatedAt',
  transform: row => ({
    selector: {
      id: row.id
    },
    modifiers: {
      $set: row
    }
  }),
  table: 'table',
  updatedAtUpdateDelay: 10000,
  pollInterval: 5000,
  strategy: STRATEGIES.POLLING,
  getQuery
};

const SyncStatus = new Meteor.Collection('mySQLSync.syncStatus');
const MySQLSync = {};

MySQLSync.connections = [];
MySQLSync.liveConnections = [];
MySQLSync.SyncStatus = SyncStatus;

function getStatusKey(table, updatedAtColumn) {
  return `${table}.${updatedAtColumn}`;
}

function select(connection, query, onRow) {
  const future = new Future();
  let errorThrown = false;
  const select = connection.query(query);

  select.on('result', Meteor.bindEnvironment(row => {
    connection.pause();
    onRow(row);
    connection.resume();
  }));
  select.on('error', error => {
    errorThrown = true;
    future.throw(error);
  });
  select.on('end', () => {
    // error already thrown, but end is still called
    if (errorThrown) {
      return;
    }

    future.return();
  });

  return future.wait();
}

function poll(settings, options, onRow) {
  const table = options.table;
  const updatedAtColumn = options.updatedAtColumn;
  const connections = MySQLSync.connections;
  const connection = MySQL.createConnection(settings);
  connections.push(connection);
  const connect = Meteor.wrapAsync(connection.connect, connection);
  const end = Meteor.wrapAsync(connection.end, connection);
  connect();

  let updatedAt = MySQLSync._getUpdatedAt(table, updatedAtColumn);
  Log.info(`[MySQLSync] Poll ${table} from ${updatedAt || 'the beginning'}`);
  do {
    const query = LiveMySQL.prototype._escapeQueryFun.bind({db: connection})(
      options.getQuery(table, updatedAtColumn, updatedAt)
    );
    select(connection, query, onRow);
    if (options.strategy === STRATEGIES.POLLING) {
      Meteor._sleepForMs(options.pollInterval);
      updatedAt = MySQLSync._getUpdatedAt(table, updatedAtColumn);
    }
  } while (options.strategy === STRATEGIES.POLLING);

  const index = connections.indexOf(connection);
  if (index > -1) {
    connections.splice(index, 1);
  }
  end();
}

function tail(settings, options, onRow) {
  const table = options.table;
  const updatedAtColumn = options.updatedAtColumn;
  const updatedAt = MySQLSync._getUpdatedAt(table, updatedAtColumn);

  if (!settings.serverId) {
    settings.serverId = _.random(MIN_SERVER_ID, MAX_SERVER_ID);
  }

  const liveConnection = new LiveMySQL(settings);
  MySQLSync.liveConnections.push(liveConnection);

  Log.info(`[MySQLSync] Syncing ${table} from ${updatedAt || 'the beginning'}`);

  liveConnection
    .select(options.getQuery(table, updatedAtColumn, updatedAt), [{table}])
    .on('update', Meteor.bindEnvironment((diff, rows) => _.each(rows, onRow)));
}

MySQLSync._getUpdatedAt = function(table, updatedAtColumn) {
  const status = SyncStatus.findOne({
    _id: getStatusKey(table, updatedAtColumn)
  });

  return status && status.updatedAt;
};

MySQLSync._updateUpdatedAt = function(table, updatedAtColumn, updatedAt) {
  try {
    SyncStatus.upsert({
      _id: getStatusKey(table, updatedAtColumn),
      updatedAt: {$lt: updatedAt}
    }, {$set: {
      updatedAt
    }});
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }
  }
};

MySQLSync.sync = function(settings, collection, providedOptions) {
  const options = _.extend({}, DEFAULT_OPTIONS, providedOptions);
  const table = options.table;
  const updatedAtColumn = options.updatedAtColumn;
  let updatedAt;
  const updateUpdatedAt = _.throttle(Meteor.bindEnvironment(() => {
    MySQLSync._updateUpdatedAt(table, updatedAtColumn, updatedAt);
  }), options.updatedAtUpdateDelay);
  const onRow = function(row) {
    const now = row._mysql_sync_now;
    const parameters = options.transform(_.omit(row, '_mysql_sync_now'));

    try {
      collection.upsert(
        parameters.selector,
        parameters.modifiers,
        parameters.options
      );
    } catch (error) {
      Log.warn(
        `[MySQLSync] Failed to upsert document to collection \
${collection._name} ${JSON.stringify(parameters)}`
      );
      throw error;
    }

    const updatedAtMoment = moment(row[updatedAtColumn] || null);
    if (!updatedAtMoment.isValid()) {
      Log.warn(
        `[MySQLSync] Found invalid updatedAt (${table}.${updatedAtColumn})`
      );

      return;
    }

    if (now && updatedAtMoment.isAfter(now)) {
      Log.warn(
        `[MySQLSync] Found updatedAt (${table}.${updatedAtColumn}) \
in the future: ${updatedAtMoment.format()} > \
${moment(now).format()}`
      );

      return;
    }

    updatedAt = updatedAtMoment.toDate();

    updateUpdatedAt();
  };

  Future.task(() => {
    poll(settings, options, onRow);
    if (options.strategy === STRATEGIES.OPLOG_TAILING) {
      tail(settings, options, onRow);
    }
  }).detach();
};

const closeAndExit = Meteor.bindEnvironment(() => {
  _.each(MySQLSync.connections, connection => {
    const end = Meteor.wrapAsync(connection.end, connection);
    try {
      end();
    } catch (error) {
      Log.warn(`[MySQLSync] Error while closing connection: ${error}`);
    }
  });
  _.each(MySQLSync.liveConnections, liveConnection => {
    try {
      liveConnection.end();
    } catch (error) {
      Log.warn(`[MySQLSync] Error while closing live connection: ${error}`);
    }
  });
  process.exit();
});

// Close connections on hot code push
process.on('SIGTERM', closeAndExit);
// Close connections on exit (ctrl + c)
process.on('SIGINT', closeAndExit);

export {MySQLSync};
