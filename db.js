import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const LISTINGS_FILE = path.join(DATA_DIR, 'listings.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');

const SEED = [
  { id: 's1', type: 'house', title: '1,125 Sq. Ft. Double Storey House', desc: 'Beautiful double storey house with 3 bedrooms, 2 bathrooms, drawing room, TV lounge, kitchen, car porch. Marble flooring, good ventilation. Near park and mosque.', price: 12500000, size: 1125, unit: 'sqft', area: 'Somnath Road', city: 'Veraval', lat: 20.9082, lng: 70.3703, images: ['/assets/sample_house.png'], contact: { name: 'Ahmed Khan', phone: '0300-1234567' }, date: '2026-05-19', status: 'active' },
  { id: 's2', type: 'plot', title: '2,250 Sq. Ft. Residential Plot', desc: 'Prime location 2,250 Sq. Ft. plot in a developed sector. All utilities available — gas, electricity, water. Wide road access. Ideal for building a dream home.', price: 8500000, size: 2250, unit: 'sqft', area: 'College Road', city: 'Una', lat: 20.8227, lng: 71.0421, images: ['/assets/sample_plot.png'], contact: { name: 'Sara Ali', phone: '0321-9876543' }, date: '2026-05-18', status: 'active' },
  { id: 's3', type: 'house', title: '2,250 Sq. Ft. Luxury Bungalow', desc: 'Spacious 2,250 Sq. Ft. bungalow with 5 bedrooms, servant quarter, modern kitchen, lawn area. Fully furnished with imported fittings. Prime corner location.', price: 32000000, size: 2250, unit: 'sqft', area: 'Girnar Road', city: 'Junagadh', lat: 21.5222, lng: 70.4579, images: ['/assets/sample_house.png'], contact: { name: 'Usman Tariq', phone: '0333-4567890' }, date: '2026-05-17', status: 'active' },
  { id: 's4', type: 'plot', title: '500 Sq. Yards Plot — Corner', desc: 'Corner plot with 80 ft front. All amenities nearby including school, hospital, market. Gated community with 24/7 security. Ready for immediate construction.', price: 25000000, size: 500, unit: 'sqyd', area: 'ST Bus Stand Area', city: 'Veraval', lat: 20.9021, lng: 70.3642, images: ['/assets/sample_plot.png'], contact: { name: 'Bilal Hussain', phone: '0345-6789012' }, date: '2026-05-16', status: 'active' },
  { id: 's5', type: 'house', title: '675 Sq. Ft. Brand New House', desc: 'Newly constructed 675 Sq. Ft. house with 2 bedrooms, 1 bathroom, kitchen, small lawn. Perfect for small families. Near main road.', price: 5500000, size: 675, unit: 'sqft', area: 'Delwada Road', city: 'Una', lat: 20.8175, lng: 71.0315, images: ['/assets/sample_house.png'], contact: { name: 'Fatima Noor', phone: '0312-3456789' }, date: '2026-05-15', status: 'active' },
  { id: 's6', type: 'plot', title: '1,125 Sq. Ft. Plot — Prime Location', desc: '1,125 Sq. Ft. residential plot with all utilities. Surrounded by constructed houses. Walking distance from commercial market.', price: 4200000, size: 1125, unit: 'sqft', area: 'Kalwa Chowk', city: 'Junagadh', lat: 21.5210, lng: 70.4601, images: ['/assets/sample_plot.png'], contact: { name: 'Kamran Sheikh', phone: '0300-5678901' }, date: '2026-05-14', status: 'active' },
  { id: 's7', type: 'house', title: '1,575 Sq. Ft. House with Basement', desc: 'Modern 1,575 Sq. Ft. house with basement, ground and first floor. 4 bedrooms, 3 bathrooms, American kitchen, car parking for 2 cars.', price: 18000000, size: 1575, unit: 'sqft', area: 'Zanzarda Road', city: 'Junagadh', lat: 21.5150, lng: 70.4480, images: ['/assets/sample_house.png'], contact: { name: 'Hasan Raza', phone: '0334-7890123' }, date: '2026-05-13', status: 'active' },
  { id: 's8', type: 'plot', title: '1,000 Sq. Yards Farm House Plot', desc: 'Beautiful 1,000 Sq. Yards plot in farm house scheme. Lush green surroundings, ideal for weekend retreat or farm house construction.', price: 15000000, size: 1000, unit: 'sqyd', area: 'Rajpara', city: 'Veraval', lat: 20.9150, lng: 70.3810, images: ['/assets/sample_plot.png'], contact: { name: 'Ayesha Malik', phone: '0315-8901234' }, date: '2026-05-12', status: 'active' }
];

const CATEGORIES_SEED = {
  propertyTypes: [
    { id: 'house', label: 'House', icon: '🏠' },
    { id: 'plot', label: 'Plot', icon: '📐' },
    { id: 'apartment', label: 'Apartment', icon: '🏢' },
    { id: 'commercial', label: 'Commercial', icon: '🏪' },
    { id: 'farmhouse', label: 'Farm House', icon: '🌾' }
  ],
  cities: [
    { id: 'veraval', label: 'Veraval', lat: 20.9082, lng: 70.3703 },
    { id: 'una', label: 'Una', lat: 20.8227, lng: 71.0421 },
    { id: 'junagadh', label: 'Junagadh', lat: 21.5222, lng: 70.4579 }
  ],
  amenities: [
    { id: 'parking', label: 'Car Parking', icon: '🅿️' },
    { id: 'garden', label: 'Garden/Lawn', icon: '🌿' },
    { id: 'security', label: '24/7 Security', icon: '🔒' },
    { id: 'water', label: 'Water Supply', icon: '💧' },
    { id: 'electricity', label: 'Electricity', icon: '⚡' },
    { id: 'gas', label: 'Gas', icon: '🔥' }
  ],
  priceRanges: [
    { id: 'under5l', label: 'Under ₨ 5 Lac', min: 0, max: 500000 },
    { id: '5l-25l', label: '₨ 5 Lac – 25 Lac', min: 500000, max: 2500000 },
    { id: '25l-50l', label: '₨ 25 Lac – 50 Lac', min: 2500000, max: 5000000 },
    { id: '50l-1cr', label: '₨ 50 Lac – 1 Crore', min: 5000000, max: 10000000 },
    { id: '1cr-5cr', label: '₨ 1 Crore – 5 Crore', min: 10000000, max: 50000000 },
    { id: 'above5cr', label: 'Above ₨ 5 Crore', min: 50000000, max: null }
  ]
};

class AtomicJSONStore {
  constructor(filePath, defaultData = []) {
    this.filePath = filePath;
    this.defaultData = defaultData;
    this.queue = Promise.resolve();
  }

  async read() {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          await fs.mkdir(path.dirname(this.filePath), { recursive: true });
          const content = await fs.readFile(this.filePath, 'utf8');
          resolve(JSON.parse(content));
        } catch (err) {
          if (err.code === 'ENOENT') {
            // Write defaults if file does not exist
            try {
              await fs.writeFile(this.filePath, JSON.stringify(this.defaultData, null, 2), 'utf8');
              resolve(this.defaultData);
            } catch (wErr) {
              reject(wErr);
            }
          } else {
            reject(err);
          }
        }
      });
    });
  }

  async write(data) {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          await fs.mkdir(path.dirname(this.filePath), { recursive: true });
          const tempPath = this.filePath + '.tmp';
          await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
          await fs.rename(tempPath, this.filePath);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');
const SETTINGS_SEED = {
  helpMobile: '+91 98765 43210',
  helpEmail: 'support@marimilkat.com',
  helpHours: 'Mon - Sat: 9:00 AM - 8:00 PM',
};

const listingsStore = new AtomicJSONStore(LISTINGS_FILE, SEED);
const usersStore = new AtomicJSONStore(USERS_FILE, []);
const reportsStore = new AtomicJSONStore(REPORTS_FILE, []);
const categoriesStore = new AtomicJSONStore(CATEGORIES_FILE, CATEGORIES_SEED);
const settingsStore = new AtomicJSONStore(SETTINGS_FILE, SETTINGS_SEED);
const inquiriesStore = new AtomicJSONStore(INQUIRIES_FILE, []);

export async function getListings() {
  return await listingsStore.read();
}

export async function saveListings(listings) {
  await listingsStore.write(listings);
}

export async function getUsers() {
  return await usersStore.read();
}

export async function saveUsers(users) {
  await usersStore.write(users);
}

export async function getReports() {
  return await reportsStore.read();
}

export async function saveReports(reports) {
  await reportsStore.write(reports);
}

export async function getCategories() {
  return await categoriesStore.read();
}

export async function saveCategories(categories) {
  await categoriesStore.write(categories);
}

export async function getSettings() {
  return await settingsStore.read();
}

export async function saveSettings(settings) {
  await settingsStore.write(settings);
}

export async function getInquiries() {
  return await inquiriesStore.read();
}

export async function saveInquiries(inquiries) {
  await inquiriesStore.write(inquiries);
}

