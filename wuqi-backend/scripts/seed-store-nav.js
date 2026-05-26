require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../src/config');

const Store = require('../src/models/Store');

async function seed() {
  await mongoose.connect(config.mongodbUri);
  console.log('Connected to MongoDB');

  const stores = await Store.find({});
  console.log(`Found ${stores.length} stores`);

  for (const store of stores) {
    const name = store.name || '';
    let nav_name, latitude, longitude;

    if (name.includes('福永')) {
      nav_name = '舞栖舞蹈社（福永店）';
      latitude = 22.673711370073942;
      longitude = 113.80758091807364;
    } else if (name.includes('固戍')) {
      nav_name = '舞栖舞蹈社（固戍店）';
      latitude = 22.60050244431253;
      longitude = 113.8477899134159;
    } else {
      console.log(`Skip: ${name}`);
      continue;
    }

    store.nav_name = nav_name;
    store.location = { latitude, longitude };
    await store.save();
    console.log(`Updated: ${name} → nav_name=${nav_name}, lat=${latitude}, lng=${longitude}`);
  }

  await mongoose.disconnect();
  console.log('Done');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});