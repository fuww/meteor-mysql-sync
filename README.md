# MySQLSync

Synchronization of MySQL tables to mongodb collections

## Usage

```js
// meteor collection to copy the MySQL rows
var Car = new Meteor.Collection('cars');

MySQLSync.sync({
  // MySQL connection options
  // see the documentation of the MySQL npm package
  host: 'MySQL-database.example.com',
  port: 3306,
  user: 'sync',
  password: 's3cr3t',
  database: 'garage'
}, Car, {
  // column name of the last modification date, should be indexed!
  updatedAtColumn: 'last_modified_date',
  transform: function(row) {
    // gets the MySQL row as a parameter and returns the following parameters
    // for mongodb upsert operation

    return {
      selector: {
        // mongodb selector
        id: row.id // id from MySQL
      },
      modifiers: {
        // mongodb modifiers $set, $unset, $setOnInsert, ...
        $set: {
          licenseNumber: row.license_number,
          color: row.color,
          owner: row.owner_name
        }
      },
      options: {
        // mongodb options (multi: true, etc...)
      }
    };
  },
  table: 'cars', // MySQL table
  updatedAtUpdateDelay: 10000, // saving of updated at to mongodb throttled to n ms
  pollInterval: 5000, // how often the table should be polled in ms
  strategy: 'polling', // or 'oplog_tailing'
  // this is the default implementation of the function to get the MySQL query,
  // if you don't have a custom query just omit it
  // keep in mind that with oplog tailing only a limited set of queries supported
  getQuery: function getQuery(table, updatedAtColumn, updatedAt) {
    return function query(esc, escId) {
      // make sure you escape all the values (esc) and identifiers (escId)
      // use always the table, updatedAtColumn values set in the options
      // updatedAt contains the latest modification date
      let sqlQuery = `SELECT * FROM ${escId(table)}`;
      const escapedUpdatedAtColumn = escId(updatedAtColumn);

      // make sure you select only the recently modified items
      if (updatedAt) {
        sqlQuery += ` WHERE ${escapedUpdatedAtColumn} > ${esc(updatedAt)}`;
      }

      // make sure you order them by the date of modification ascending
      sqlQuery += ` ORDER BY ${escapedUpdatedAtColumn} ASC`;

      return sqlQuery;
    };
  }
});
```
