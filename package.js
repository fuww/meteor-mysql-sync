/* eslint-disable prefer-arrow-callback */

Package.describe({
  name: 'fuww:mysql-sync',
  version: '0.0.1',
  summary: 'Synchronization of MySQL tables to mongodb collections',
  git: 'https://github.com/fuww/mysql-sync.git',
  documentation: 'README.md'
});

Npm.depends({
  'mysql-live-select': '1.0.3'
});

Package.onUse(function(api) {
  api.use([
    'meteor',
    'underscore@1.0.6',
    'ecmascript@0.4.0',
    'momentjs:moment@2.12.0',
    'logging@1.0.10'
  ], 'server');

  api.mainModule('server/main.js', 'server');

  api.export([
    'MySQLSync'
  ], 'server');
});
