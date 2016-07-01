# MySQLSync

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
  strategy: 'polling' // or 'oplog_tailing'
});
```
