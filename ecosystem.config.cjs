module.exports = {
  apps: [
    {
      name: 'kk-crm',
      script: 'server/index.js',
      cwd: '/var/www/kk-crm',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_NAME: 'kk_unternehmens_db',
        DB_USER: 'katzenmayer',
        DB_PASSWORD: 'kk-crm-2026!',
      },
    },
  ],
};
