import 'dotenv/config';

// Every test process talks to the test database, never the development one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
