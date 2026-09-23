import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(BACKEND_DIR, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://osowusrcwpqqxhcjzaom.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('\x1b[31m[ERROR] SUPABASE_KEY is missing in backend/.env!\x1b[0m');
  console.log('Please get your service_role or anon key from Supabase Dashboard -> Project Settings -> API');
  console.log('and paste it into backend/.env like: SUPABASE_KEY=eyJhbGci...');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DATA_DIR = path.join(BACKEND_DIR, 'data');

async function readLocalJSON(fileName, fallback = []) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, fileName), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

async function migrateCollection(tableName, fileName, primaryKeyProp = 'id', isArray = true) {
  console.log(`\n⏳ Migrating ${tableName} from ${fileName}...`);
  const data = await readLocalJSON(fileName, isArray ? [] : {});

  if (isArray) {
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`ℹ️ No records found in ${fileName}, skipping.`);
      return;
    }

    const rows = data.map(item => {
      const row = {
        data: item,
        updated_at: new Date().toISOString()
      };
      if (primaryKeyProp === 'email' || tableName === 'users') {
        row.email = String(item.email || item[primaryKeyProp] || item.id);
      } else {
        row.id = String(item[primaryKeyProp] || item.id || item.email || crypto.randomUUID());
      }
      return row;
    });

    const { error } = await supabase.from(tableName).upsert(rows);
    if (error) {
      console.error(`❌ Error migrating ${tableName}:`, error.message);
      if (error.code === '42P01' || error.message.includes('relation') || error.message.includes('does not exist')) {
        console.warn(`💡 Table '${tableName}' does not exist yet. Please execute supabase_schema.sql in the Supabase SQL Editor.`);
      }
    } else {
      console.log(`✅ Successfully migrated ${rows.length} records into '${tableName}' table.`);
    }
  } else {
    // Single document table (categories, settings)
    const row = {
      id: 'main',
      data: data,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from(tableName).upsert(row);
    if (error) {
      console.error(`❌ Error migrating ${tableName}:`, error.message);
    } else {
      console.log(`✅ Successfully migrated '${tableName}' configuration.`);
    }
  }
}

async function run() {
  console.log(`\x1b[36m🚀 Starting Supabase Migration to ${SUPABASE_URL}...\x1b[0m`);

  await migrateCollection('listings', 'listings.json', 'id', true);
  await migrateCollection('users', 'users.json', 'email', true);
  await migrateCollection('reports', 'reports.json', 'id', true);
  await migrateCollection('inquiries', 'inquiries.json', 'id', true);
  await migrateCollection('categories', 'categories.json', 'id', false);
  await migrateCollection('settings', 'settings.json', 'id', false);

  console.log(`\n\x1b[32m🎉 Migration process completed!\x1b[0m\n`);
}

run().catch(err => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
