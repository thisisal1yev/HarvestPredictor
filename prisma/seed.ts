import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Password123!";
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);

const NOW = new Date();
const YEAR = NOW.getFullYear();

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86400000);
}

function rand(min: number, max: number) {
  return +(min + Math.random() * (max - min)).toFixed(2);
}

async function hashPassword(plain: string) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

// ── Users ────────────────────────────────────────────────
async function seedUsers() {
  console.log("👤 Seeding users...");
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const superAdmin = await prisma.user.upsert({
    where: { email: "admin@mlr.local" },
    update: { name: "Super Admin", passwordHash, role: "admin" },
    create: { email: "admin@mlr.local", name: "Super Admin", passwordHash, role: "admin" },
  });

  const farmer1 = await prisma.user.upsert({
    where: { email: "farmer1@mlr.local" },
    update: { name: "Demo Farmer 1", passwordHash, role: "farmer" },
    create: { email: "farmer1@mlr.local", name: "Demo Farmer 1", passwordHash, role: "farmer" },
  });

  const farmer2 = await prisma.user.upsert({
    where: { email: "farmer2@mlr.local" },
    update: { name: "Demo Farmer 2", passwordHash, role: "farmer" },
    create: { email: "farmer2@mlr.local", name: "Demo Farmer 2", passwordHash, role: "farmer" },
  });

  console.log("✅ Users seeded:", [superAdmin.email, farmer1.email, farmer2.email].join(", "));
  return { superAdmin, farmer1, farmer2 };
}

// ── Full data per user ───────────────────────────────────
async function seedFullData(userId: string, label: string) {
  console.log(`\n🌾 Seeding full data for ${label}...`);

  // ── Farm ──
  const farm = await prisma.farm.create({
    data: { userId, name: `${label}'s Farm`, location: "Tashkent, Uzbekistan" },
  });
  const farm2 = await prisma.farm.create({
    data: { userId, name: `${label}'s South Farm`, location: "Samarkand, Uzbekistan" },
  });
  console.log("  ✅ Farms:", farm.id, farm2.id);

  // ── Fields ──
  const fieldA = await prisma.field.create({
    data: { farmId: farm.id, name: "Wheat North", area: 15.2, cropType: "Wheat" },
  });
  const fieldB = await prisma.field.create({
    data: { farmId: farm.id, name: "Cotton East", area: 8.4, cropType: "Cotton" },
  });
  const fieldC = await prisma.field.create({
    data: { farmId: farm2.id, name: "Corn Valley", area: 20.0, cropType: "Corn" },
  });
  console.log("  ✅ Fields:", fieldA.id, fieldB.id, fieldC.id);

  // ── Seasons ──
  const seasonA1 = await prisma.season.create({
    data: {
      fieldId: fieldA.id, year: YEAR, crop: "Wheat",
      startDate: new Date(YEAR, 2, 1), endDate: new Date(YEAR, 7, 15),
      notes: "Current season — spring wheat",
    },
  });
  const seasonA2 = await prisma.season.create({
    data: {
      fieldId: fieldA.id, year: YEAR - 1, crop: "Wheat",
      startDate: new Date(YEAR - 1, 2, 1), endDate: new Date(YEAR - 1, 7, 20),
      notes: "Previous year wheat harvest",
    },
  });
  const seasonB1 = await prisma.season.create({
    data: {
      fieldId: fieldB.id, year: YEAR, crop: "Cotton",
      startDate: new Date(YEAR, 3, 15), endDate: new Date(YEAR, 9, 15),
      notes: "Cotton season in progress",
    },
  });
  const seasonC1 = await prisma.season.create({
    data: {
      fieldId: fieldC.id, year: YEAR, crop: "Corn",
      startDate: new Date(YEAR, 3, 1), endDate: new Date(YEAR, 8, 30),
      notes: "Corn season — first planting on this field",
    },
  });
  const seasonC2 = await prisma.season.create({
    data: {
      fieldId: fieldC.id, year: YEAR - 1, crop: "Sunflower",
      startDate: new Date(YEAR - 1, 3, 10), endDate: new Date(YEAR - 1, 9, 1),
      notes: "Sunflower rotation experiment",
    },
  });
  console.log("  ✅ Seasons: 5");

  // ── Sensor Devices ──
  const sensorA = await prisma.sensorDevice.create({
    data: { fieldId: fieldA.id, name: "Soil Probe WN-1", type: "soil_multi" },
  });
  const sensorB = await prisma.sensorDevice.create({
    data: { fieldId: fieldB.id, name: "Soil Probe CE-1", type: "soil_multi" },
  });
  const sensorC = await prisma.sensorDevice.create({
    data: { fieldId: fieldC.id, name: "Soil Probe CV-1", type: "soil_multi" },
  });
  console.log("  ✅ Sensor Devices: 3");

  // ── Sensor Readings (10 per device, over last 30 days) ──
  for (const device of [sensorA, sensorB, sensorC]) {
    const readings = Array.from({ length: 10 }, (_, i) => ({
      sensorDeviceId: device.id,
      timestamp: daysAgo(i * 3),
      moisture: rand(12, 45),
      nitrogen: rand(8, 35),
      phosphorus: rand(10, 30),
      potassium: rand(100, 250),
      temperature: rand(15, 38),
      pH: rand(5.2, 8.2),
    }));
    await prisma.sensorReading.createMany({ data: readings });
  }
  console.log("  ✅ Sensor Readings: 30 (10 per device)");

  // ── Drone Flights ──
  const flightA1 = await prisma.droneFlight.create({
    data: { fieldId: fieldA.id, date: daysAgo(2), altitude: 120, notes: "Routine NDVI scan" },
  });
  const flightA2 = await prisma.droneFlight.create({
    data: { fieldId: fieldA.id, date: daysAgo(14), altitude: 100, notes: "Mid-season check" },
  });
  const flightB1 = await prisma.droneFlight.create({
    data: { fieldId: fieldB.id, date: daysAgo(5), altitude: 110, notes: "Cotton field survey" },
  });
  const flightC1 = await prisma.droneFlight.create({
    data: { fieldId: fieldC.id, date: daysAgo(7), altitude: 130, notes: "Corn growth assessment" },
  });
  console.log("  ✅ Drone Flights: 4");

  // ── Vegetation Index Points (3-5 per flight) ──
  const vegPoints = [
    // Flight A1 — good NDVI
    { droneFlightId: flightA1.id, timestamp: daysAgo(2), ndvi: 0.72, evi: 0.45, lat: 41.311, lng: 69.279 },
    { droneFlightId: flightA1.id, timestamp: daysAgo(2), ndvi: 0.68, evi: 0.42, lat: 41.312, lng: 69.280 },
    { droneFlightId: flightA1.id, timestamp: daysAgo(2), ndvi: 0.75, evi: 0.48, lat: 41.313, lng: 69.281 },
    // Flight A2 — slightly higher NDVI (earlier in season)
    { droneFlightId: flightA2.id, timestamp: daysAgo(14), ndvi: 0.81, evi: 0.52, lat: 41.311, lng: 69.279 },
    { droneFlightId: flightA2.id, timestamp: daysAgo(14), ndvi: 0.79, evi: 0.50, lat: 41.312, lng: 69.280 },
    // Flight B1 — lower NDVI for cotton
    { droneFlightId: flightB1.id, timestamp: daysAgo(5), ndvi: 0.55, evi: 0.33, lat: 41.320, lng: 69.290 },
    { droneFlightId: flightB1.id, timestamp: daysAgo(5), ndvi: 0.48, evi: 0.28, lat: 41.321, lng: 69.291 },
    { droneFlightId: flightB1.id, timestamp: daysAgo(5), ndvi: 0.25, evi: 0.14, lat: 41.322, lng: 69.292 }, // stress zone
    // Flight C1 — corn
    { droneFlightId: flightC1.id, timestamp: daysAgo(7), ndvi: 0.64, evi: 0.39, lat: 39.654, lng: 66.960 },
    { droneFlightId: flightC1.id, timestamp: daysAgo(7), ndvi: 0.61, evi: 0.37, lat: 39.655, lng: 66.961 },
    { droneFlightId: flightC1.id, timestamp: daysAgo(7), ndvi: 0.58, evi: 0.35, lat: 39.656, lng: 66.962 },
  ];
  await prisma.vegetationIndexPoint.createMany({ data: vegPoints });
  console.log("  ✅ Vegetation Index Points: 11");

  // ── Yield Records ──
  await prisma.yieldRecord.createMany({
    data: [
      { seasonId: seasonA2.id, yieldValue: 4.2, unit: "t/ha", harvestDate: new Date(YEAR - 1, 7, 20) },
      { seasonId: seasonC2.id, yieldValue: 2.8, unit: "t/ha", harvestDate: new Date(YEAR - 1, 9, 1) },
    ],
  });
  console.log("  ✅ Yield Records: 2 (historical seasons)");

  // ── Predictions ──
  await prisma.prediction.createMany({
    data: [
      { seasonId: seasonA1.id, predictedYield: 4.5, confidence: 0.82, modelVersion: "mlr-v1" },
      { seasonId: seasonB1.id, predictedYield: 3.1, confidence: 0.74, modelVersion: "mlr-v1" },
      { seasonId: seasonC1.id, predictedYield: 6.8, confidence: 0.78, modelVersion: "mlr-v1" },
    ],
  });
  console.log("  ✅ Predictions: 3");

  // ── Recommendations ──
  await prisma.recommendation.createMany({
    data: [
      {
        fieldId: fieldA.id, seasonId: seasonA1.id,
        type: "fertilizer", title: "Increase nitrogen application",
        description: "Soil nitrogen levels are below optimal (14 mg/kg). Apply 40 kg/ha of urea before next irrigation.",
        priority: "high",
        payload: { nitrogen_deficit: 6, recommended_urea_kg_ha: 40 },
      },
      {
        fieldId: fieldB.id, seasonId: seasonB1.id,
        type: "irrigation", title: "Schedule supplemental irrigation",
        description: "Moisture levels have dropped to 18%. Cotton requires consistent moisture during flowering stage.",
        priority: "high",
        payload: { current_moisture: 18, target_moisture: 30 },
      },
      {
        fieldId: fieldB.id, seasonId: seasonB1.id,
        type: "treatment", title: "Scout for pest activity",
        description: "Low NDVI zone detected in Cotton East field. Possible pest damage — inspect zone at 41.322, 69.292.",
        priority: "medium",
        payload: { zone_lat: 41.322, zone_lng: 69.292, ndvi: 0.25 },
      },
      {
        fieldId: fieldC.id, seasonId: seasonC1.id,
        type: "fertilizer", title: "Apply phosphorus supplement",
        description: "Phosphorus levels at 12 mg/kg. Corn requires 20+ mg/kg during early growth. Apply DAP at 25 kg/ha.",
        priority: "medium",
        payload: { phosphorus_current: 12, recommended_dap_kg_ha: 25 },
      },
      {
        fieldId: fieldC.id,
        type: "crop", title: "Consider crop rotation next season",
        description: "Corn Valley has grown corn this year and sunflower last year. Rotating to legumes (e.g. soybean) will restore nitrogen.",
        priority: "low",
      },
    ],
  });
  console.log("  ✅ Recommendations: 5");

  // ── Alerts ──
  await prisma.alert.createMany({
    data: [
      {
        fieldId: fieldB.id, rule: "low_ndvi",
        message: `Low NDVI (0.25) detected on Cotton East — possible stress zone`,
        severity: "critical", status: "active", triggeredAt: daysAgo(5),
      },
      {
        fieldId: fieldA.id, rule: "low_nitrogen",
        message: `Low nitrogen level (14 mg/kg) on Wheat North`,
        severity: "warning", status: "active", triggeredAt: daysAgo(3),
      },
      {
        fieldId: fieldB.id, rule: "low_moisture",
        message: `Low soil moisture (18%) detected on Cotton East`,
        severity: "warning", status: "active", triggeredAt: daysAgo(4),
      },
      {
        fieldId: fieldC.id, rule: "ph_out_of_range",
        message: `pH level (8.1) out of optimal range on Corn Valley`,
        severity: "warning", status: "resolved", triggeredAt: daysAgo(10),
      },
      {
        fieldId: fieldA.id, rule: "ndvi_drop",
        message: `NDVI dropped 12% on Wheat North (avg 0.80 → 0.72)`,
        severity: "warning", status: "dismissed", triggeredAt: daysAgo(2),
      },
    ],
  });
  console.log("  ✅ Alerts: 5 (3 active, 1 resolved, 1 dismissed)");

  console.log(`✅ Full data seeded for ${label}`);
}

// ── Lifecycle ────────────────────────────────────────────
async function up() {
  console.log("🌱 Starting seed process...\n");
  requireEnv("DATABASE_URL");

  const { superAdmin, farmer1, farmer2 } = await seedUsers();

  await seedFullData(superAdmin.id, "Super Admin");
  await seedFullData(farmer1.id, "Farmer 1");
  await seedFullData(farmer2.id, "Farmer 2");

  // Seed Knowledge Base
  const diseases = [
    { diseaseName: 'Fusarium wilt', diseaseNameUz: 'Fuzarioz so\'lishi', category: 'disease', symptoms: 'Yellowing and wilting of leaves, brown discoloration of vascular tissue', symptomsUz: 'Barglarning sarg\'ayishi va so\'lishi', treatment: 'Apply Fundazol 1.5 kg/ha. Remove infected plants. Rotate crops for 3-4 years.', treatmentUz: 'Fundazol 1.5 kg/ga qo\'llang. Kasallangan o\'simliklarni olib tashlang.', prevention: 'Use resistant varieties. Practice crop rotation. Ensure proper drainage.', severity: 'critical', cropTypes: ['cotton', 'melon', 'tomato'] },
    { diseaseName: 'Alternaria leaf spot', diseaseNameUz: 'Alternarioz barg dog\'i', category: 'disease', symptoms: 'Dark brown to black concentric ring spots on leaves', treatment: 'Spray with chlorothalonil or mancozeb every 7-10 days', severity: 'high', cropTypes: ['tomato', 'potato', 'pepper'] },
    { diseaseName: 'Powdery mildew', diseaseNameUz: 'Un shudring kasalligi', category: 'disease', symptoms: 'White powdery coating on leaves and stems', treatment: 'Apply sulfur-based fungicide or neem oil. Improve air circulation.', severity: 'medium', cropTypes: ['grape', 'cucumber', 'wheat'] },
    { diseaseName: 'Wheat rust', diseaseNameUz: 'Bug\'doy zanglashi', category: 'disease', symptoms: 'Orange-brown pustules on leaves and stems', treatment: 'Apply propiconazole or tebuconazole fungicide at first sign', severity: 'high', cropTypes: ['wheat'] },
    { diseaseName: 'Root rot', diseaseNameUz: 'Ildiz chirishi', category: 'disease', symptoms: 'Wilting despite adequate water, brown mushy roots', treatment: 'Improve drainage. Apply metalaxyl. Remove severely affected plants.', severity: 'critical', cropTypes: ['cotton', 'tomato'] },
    { diseaseName: 'Spider mite', diseaseNameUz: 'O\'rgimchak kanasi', category: 'pest', symptoms: 'Tiny yellow spots on leaves, fine webbing on undersides', treatment: 'Spray with abamectin or bifenthrin. Release predatory mites.', severity: 'high', cropTypes: ['cotton', 'tomato', 'cucumber'] },
    { diseaseName: 'Aphid infestation', diseaseNameUz: 'Shiralar tajovuzi', category: 'pest', symptoms: 'Clusters of small green/black insects on new growth, sticky honeydew', treatment: 'Apply imidacloprid or release ladybugs. Spray with neem oil.', severity: 'medium', cropTypes: ['cotton', 'wheat', 'vegetable'] },
    { diseaseName: 'Cotton bollworm', diseaseNameUz: 'Paxta qurti', category: 'pest', symptoms: 'Holes in bolls and fruits, frass visible', treatment: 'Apply Bt (Bacillus thuringiensis) or spinosad. Use pheromone traps.', severity: 'critical', cropTypes: ['cotton', 'tomato'] },
    { diseaseName: 'Bacterial blight', diseaseNameUz: 'Bakterial kuyish', category: 'disease', symptoms: 'Water-soaked lesions on leaves turning brown with yellow halos', treatment: 'Apply copper-based bactericide. Remove infected plant material.', severity: 'high', cropTypes: ['cotton', 'rice'] },
    { diseaseName: 'Downy mildew', diseaseNameUz: 'Yolg\'on un shudring', category: 'disease', symptoms: 'Yellow patches on upper leaf surface, gray-purple fuzz underneath', treatment: 'Apply mancozeb or metalaxyl. Ensure good ventilation.', severity: 'high', cropTypes: ['melon', 'grape', 'cucumber'] }
  ]

  for (const disease of diseases) {
    await prisma.knowledgeBase.upsert({
      where: { diseaseName: disease.diseaseName },
      update: disease,
      create: disease
    })
  }
  console.log('  ✅ Knowledge Base seeded: 10 entries')

  console.log("\n✅ Seed completed successfully!");
  console.log(`🔑 Password for all users: ${SEED_PASSWORD}`);
}

async function down() {
  console.log("🧹 Cleaning database...\n");

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Alert",
      "Recommendation",
      "Prediction",
      "YieldRecord",
      "VegetationIndexPoint",
      "DroneFlight",
      "SensorReading",
      "SensorDevice",
      "Season",
      "Field",
      "Farm",
      "User",
      "CVModel",
      "KnowledgeBase"
    RESTART IDENTITY CASCADE
  `);

  console.log("✅ Database cleaned!\n");
}

async function main() {
  const args = process.argv.slice(2);

  try {
    if (args.includes("--down") || args.includes("-d")) {
      await down();
    } else if (args.includes("--seed-only") || args.includes("-s")) {
      await up();
    } else {
      await down();
      await up();
    }
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
