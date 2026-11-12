const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// Enable CORS for all origins with full preflight support
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true
}));
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ----------------------------------------------------
// 1. CONFIGURATION & DATABASE CONNECTION
// ----------------------------------------------------
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/pinkhorse_db";
const JWT_SECRET = process.env.JWT_SECRET || "pinkhorse_super_secret_jwt_key_2026";

const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "chamikasanjan03@gmail.com").toLowerCase().trim();
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Chamika123@";

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected Successfully");
    initAdminUser();
  })
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ----------------------------------------------------
// 2. MONGOOSE SCHEMAS & MODELS
// ----------------------------------------------------

// Admin Schema
const AdminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }
}, { timestamps: true });

const Admin = mongoose.model('Admin', AdminSchema);

// Video / Gallery Item Schema
const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  image: { type: String, default: '' },
  link: { type: String, default: '' },
  country: { type: String, default: '' },
  category: { type: String, default: 'General', index: true },
  pornstar: { type: String, default: '', index: true }, // Pornstar name reference
  isRemoved: { type: Boolean, default: false },
  embedUrl: { type: String, default: '' },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  description: { type: String, default: '' },
  duration: { type: String, default: '' },
  slug: { type: String, default: '', index: true }
}, { timestamps: true });

// To maintain seamless compatibility with frontend using item._id as $id
VideoSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.$id = ret._id.toString();
    ret.$createdAt = ret.createdAt;
    ret.$updatedAt = ret.updatedAt;
    return ret;
  }
});

const Video = mongoose.model('Video', VideoSchema);

// Cached Category Stats Schema (stores precomputed counts in DB)
const CategoryStatSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  count: { type: Number, default: 0 }
}, { timestamps: true });

const CategoryStat = mongoose.model('CategoryStat', CategoryStatSchema);

// Pornstar Schema
const PornstarSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  avatar: { type: String, default: '' },
  cover: { type: String, default: '' },
  description: { type: String, default: '' },
  followers: { type: String, default: '10K' },
  verified: { type: Boolean, default: true },
  socialLinks: {
    fansly: { type: String, default: '' },
    twitter: { type: String, default: '' },
    tiktok: { type: String, default: '' },
    instagram: { type: String, default: '' },
    instagram2: { type: String, default: '' },
    telegram: { type: String, default: '' },
    onlyfans: { type: String, default: '' }
  },
  tags: [{ type: String }]
}, { timestamps: true });

PornstarSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.$id = ret._id.toString();
    ret.$createdAt = ret.createdAt;
    ret.$updatedAt = ret.updatedAt;
    return ret;
  }
});

const Pornstar = mongoose.model('Pornstar', PornstarSchema);

// Broken Link / Content Reports Schema
const ReportSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  videoTitle: { type: String, default: '' },
  reason: { type: String, default: 'Broken Link' },
  captchaToken: { type: String, default: '' },
  status: { type: String, default: 'pending' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

ReportSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.$id = ret._id.toString();
    ret.$createdAt = ret.createdAt;
    ret.$updatedAt = ret.updatedAt;
    return ret;
  }
});

const Report = mongoose.model('Report', ReportSchema);

// Initialize default admin user if not present
async function initAdminUser() {
  try {
    const existing = await Admin.findOne({ email: DEFAULT_ADMIN_EMAIL });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      await Admin.create({
        email: DEFAULT_ADMIN_EMAIL,
        password: hashedPassword
      });
      console.log(`👤 Default admin initialized: ${DEFAULT_ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error("Error creating default admin:", err.message);
  }
}

// ----------------------------------------------------
// 3. AUTH MIDDLEWARE
// ----------------------------------------------------
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// ----------------------------------------------------
// 4. API ROUTES
// ----------------------------------------------------

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Pink Horse Video API' });
});

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const admin = await Admin.findOne({ email: cleanEmail });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { adminId: admin._id, email: admin.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      admin: {
        $id: admin._id.toString(),
        email: admin.email
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Get Current Logged-in Admin (Session verification)
app.get('/api/admin/me', authMiddleware, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId).select('-password');
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }
    res.json({
      $id: admin._id.toString(),
      email: admin.email
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ==================== VIDEOS / GALLERY ====================

// Helper to extract or generate clean SEO slug from pageUrl or title
function generateSlug(pageUrl, title) {
  if (pageUrl) {
    try {
      const cleanUrl = pageUrl.split('?')[0].replace(/\/+$/, '');
      const parts = cleanUrl.split('/').filter(Boolean);
      if (parts.length > 0) {
        let lastPart = parts[parts.length - 1];
        // If last part is purely numeric (e.g. video ID like /12214), try preceding part if exists
        if (/^\d+$/.test(lastPart) && parts.length > 1) {
          lastPart = parts[parts.length - 2] + '-' + lastPart;
        }
        lastPart = lastPart.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (lastPart) return lastPart;
      }
    } catch (e) {
      // Fallback
    }
  }

  if (title) {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }

  return '';
}

// Comprehensive World Country Detection Map
// Supports Country Names, Demonyms, Common Slang, and Spelling variations (e.g. Pakistan, Pakisthan, etc.)
const WORLD_COUNTRY_RULES = [
  // South Asia (Checked first to prevent overlapping matches)
  { code: 'BD', regex: /\b(bangladesh|bangladeshi|dhaka|bangla|chittagong|sylhet)\b/i },
  { code: 'LK', regex: /\b(sri\s*lanka|sri\s*lankan|lankan|sinhala|ceylon|colombo|kandy|galle|jaffna)\b|[\u0D80-\u0DFF]/i },
  { code: 'PK', regex: /\b(pakistan|pakisthan|pakistani|pakisthani|lahore|karachi|islamabad|punjabi\s*pakistan|pashto|urdu|peshawar|rawalpindi)\b/i },
  { code: 'NP', regex: /\b(nepal|nepali|nepalese|kathmandu|gurkha)\b/i },
  { code: 'IN', regex: /\b(india|indian|desi|hindi|tamil|telugu|malayalam|marathi|punjabi|gujarati|bhojpuri|kannada|assamese|bihari|delhi|mumbai|kerala|kolkata|chennai|bangalore)\b/i },

  // East & Southeast Asia
  { code: 'JP', regex: /\b(japan|japanese|jav|tokyo|osaka|kyoto)\b/i },
  { code: 'KR', regex: /\b(korea|korean|south\s*korea|seoul|busan|k-pop)\b/i },
  { code: 'CN', regex: /\b(china|chinese|mandarin|beijing|shanghai|guangzhou)\b/i },
  { code: 'TW', regex: /\b(taiwan|taiwanese|taipei)\b/i },
  { code: 'TH', regex: /\b(thailand|thai|bangkok|phuket|pattaya|siamese)\b/i },
  { code: 'VN', regex: /\b(vietnam|vietnamese|hanoi|saigon)\b/i },
  { code: 'PH', regex: /\b(philippines|filipino|filipina|pinoy|pinay|manila|tagalog)\b/i },
  { code: 'ID', regex: /\b(indonesia|indonesian|jakarta|bali|javanese)\b/i },
  { code: 'MY', regex: /\b(malaysia|malaysian|kuala\s*lumpur|malay)\b/i },
  { code: 'SG', regex: /\b(singapore|singaporean)\b/i },
  { code: 'MM', regex: /\b(myanmar|burma|burmese|yangon)\b/i },
  { code: 'KH', regex: /\b(cambodia|cambodian|khmer|phnom\s*penh)\b/i },

  // Middle East & Arab World
  { code: 'AE', regex: /\b(dubai|uae|united\s*arab\s*emirates|abu\s*dhabi|emirati)\b/i },
  { code: 'SA', regex: /\b(saudi|saudi\s*arabia|riyadh|jeddah)\b/i },
  { code: 'IR', regex: /\b(iran|iranian|persia|persian|tehran)\b/i },
  { code: 'TR', regex: /\b(turkey|turkish|istanbul|ankara)\b/i },
  { code: 'IQ', regex: /\b(iraq|iraqi|baghdad)\b/i },
  { code: 'EG', regex: /\b(egypt|egyptian|cairo)\b/i },
  { code: 'LB', regex: /\b(lebanon|lebanese|beirut)\b/i },
  { code: 'IL', regex: /\b(israel|israeli|tel\s*aviv|jerusalem)\b/i },
  { code: 'QA', regex: /\b(qatar|qatari|doha)\b/i },
  { code: 'KW', regex: /\b(kuwait|kuwaiti)\b/i },

  // Europe
  { code: 'UK', regex: /\b(united\s*kingdom|britain|british|england|english|london|scotland|scottish|wales|welsh)\b/i },
  { code: 'RU', regex: /\b(russia|russian|moscow|saint\s*petersburg)\b/i },
  { code: 'UA', regex: /\b(ukraine|ukrainian|kyiv)\b/i },
  { code: 'FR', regex: /\b(france|french|paris)\b/i },
  { code: 'DE', regex: /\b(germany|german|berlin|deutsch)\b/i },
  { code: 'IT', regex: /\b(italy|italian|rome|milan)\b/i },
  { code: 'ES', regex: /\b(spain|spanish|madrid|barcelona)\b/i },
  { code: 'PT', regex: /\b(portugal|portuguese|lisbon)\b/i },
  { code: 'NL', regex: /\b(netherlands|holland|dutch|amsterdam)\b/i },
  { code: 'BE', regex: /\b(belgium|belgian|brussels)\b/i },
  { code: 'CH', regex: /\b(switzerland|swiss|zurich|geneva)\b/i },
  { code: 'SE', regex: /\b(sweden|swedish|stockholm)\b/i },
  { code: 'NO', regex: /\b(norway|norwegian|oslo)\b/i },
  { code: 'FI', regex: /\b(finland|finnish|helsinki)\b/i },
  { code: 'DK', regex: /\b(denmark|danish|copenhagen)\b/i },
  { code: 'PL', regex: /\b(poland|polish|warsaw)\b/i },
  { code: 'CZ', regex: /\b(czech|czech\s*republic|prague)\b/i },
  { code: 'RO', regex: /\b(romania|romanian|bucharest)\b/i },
  { code: 'HU', regex: /\b(hungary|hungarian|budapest)\b/i },
  { code: 'GR', regex: /\b(greece|greek|athens)\b/i },
  { code: 'IE', regex: /\b(ireland|irish|dublin)\b/i },

  // Americas & Oceania
  { code: 'US', regex: /\b(united\s*states|usa|american|california|new\s*york|texas|florida)\b/i },
  { code: 'CA', regex: /\b(canada|canadian|toronto|vancouver|montreal)\b/i },
  { code: 'AU', regex: /\b(australia|australian|aussie|sydney|melbourne)\b/i },
  { code: 'NZ', regex: /\b(new\s*zealand|kiwi|auckland)\b/i },
  { code: 'BR', regex: /\b(brazil|brazilian|rio|sao\s*paulo)\b/i },
  { code: 'MX', regex: /\b(mexico|mexican|tijuana)\b/i },
  { code: 'CO', regex: /\b(colombia|colombian|bogota|medellin)\b/i },
  { code: 'AR', regex: /\b(argentina|argentine|buenos\s*aires)\b/i },
  { code: 'CL', regex: /\b(chile|chilean|santiago)\b/i },
  { code: 'PE', regex: /\b(peru|peruvian|lima)\b/i },
  { code: 'VE', regex: /\b(venezuela|venezuelan|caracas)\b/i },

  // Africa
  { code: 'ZA', regex: /\b(south\s*africa|south\s*african|johannesburg|cape\s*town)\b/i },
  { code: 'NG', regex: /\b(nigeria|nigerian|lagos)\b/i },
  { code: 'KE', regex: /\b(kenya|kenyan|nairobi)\b/i },
  { code: 'GH', regex: /\b(ghana|ghanaian|accra)\b/i },
  { code: 'MA', regex: /\b(morocco|moroccan|casablanca)\b/i }
];

// Helper to auto-detect country code purely from Title (returns empty '' if none found)
function detectCountry(title = '', pageUrl = '', explicitCountry = '') {
  if (explicitCountry && explicitCountry !== 'ALL' && explicitCountry !== 'AUTO' && explicitCountry !== 'NONE' && explicitCountry !== '') {
    return explicitCountry.trim().toUpperCase();
  }

  const rawTitle = (title || '').toLowerCase();
  if (!rawTitle) return '';

  for (const rule of WORLD_COUNTRY_RULES) {
    if (rule.regex.test(rawTitle)) {
      return rule.code;
    }
  }

  // If no world country keyword is found in Title, leave completely empty ('')
  return '';
}

// Public: Get videos (paginated, filterable by country & search)
app.get('/api/videos', async (req, res) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(100, parseInt(req.query.limit) || 24);
    const country = (req.query.country || '').trim().toUpperCase();
    const search  = (req.query.search  || '').trim();

    // Build filter
    const filter = {};
    if (country && country !== 'ALL') filter.country = country;
    if (req.query.pornstar) {
      filter.pornstar = { $regex: new RegExp(`^${req.query.pornstar.trim()}$`, 'i') };
    }
    if (req.query.category && req.query.category !== 'All') {
      if (req.query.category.toLowerCase() === 'general') {
        filter.$or = [
          { category: { $regex: /^general$/i } },
          { category: { $exists: false } },
          { category: null },
          { category: '' }
        ];
      } else {
        filter.category = req.query.category;
      }
    }
    if (search) {
      if (search.toLowerCase() === 'general') {
        filter.$or = [
          { title:    { $regex: search, $options: 'i' } },
          { category: { $regex: /^general$/i } },
          { category: { $exists: false } },
          { category: null },
          { category: '' }
        ];
      } else {
        filter.$or = [
          { title:    { $regex: search, $options: 'i' } },
          { country:  { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } }
        ];
      }
    }

    const sortParam = (req.query.sort || 'latest').toLowerCase();
    let sortObj = { createdAt: -1 };
    if (sortParam === 'popular') {
      sortObj = { views: -1, createdAt: -1 };
    } else if (sortParam === 'top_rated') {
      sortObj = { likes: -1, createdAt: -1 };
    } else if (sortParam === 'latest') {
      sortObj = { createdAt: -1, _id: -1 };
    }

    const total  = await Video.countDocuments(filter);
    const videos = await Video.find(filter)
      .sort(sortObj)
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      videos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Fetch videos error:", err);
    res.status(500).json({ error: 'Failed to fetch videos.' });
  }
});

const PRESET_CATEGORY_NAMES = [
  'Asian', 'Blowjob', 'Brunette', 'Big Tits', 'Hardcore', 'Amateur', 
  'Cumshot', 'Pornstar', 'Blonde', 'Anal', 'Big Dick', 'Teen', 
  'Homemade', 'POV', 'MILF', 'Lesbian', 'HD Video', 'Hotlink', 'Action',
  'Compilation', 'Erotica', 'Hentai', 'Behind the Scenes'
];

async function recomputeCategoryStats() {
  const dbDistinctCategories = await Video.distinct('category', { isRemoved: { $ne: true } });
  const allCategoryNames = Array.from(new Set([
    ...PRESET_CATEGORY_NAMES,
    ...dbDistinctCategories.filter(Boolean).map(c => c.trim())
  ])).filter(name => name.toLowerCase() !== 'general' && name.toLowerCase() !== 'all');

  const categoryPromises = allCategoryNames.map(async (name) => {
    const count = await Video.countDocuments({
      isRemoved: { $ne: true },
      $or: [
        { category: { $regex: name, $options: 'i' } },
        { title: { $regex: name, $options: 'i' } },
        { country: { $regex: name, $options: 'i' } }
      ]
    });
    return { name, count };
  });

  const [categoriesResults, totalVideos] = await Promise.all([
    Promise.all(categoryPromises),
    Video.countDocuments({ isRemoved: { $ne: true } })
  ]);

  const sortedCategories = categoriesResults.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const result = [
    { name: 'General', count: totalVideos },
    ...sortedCategories
  ];

  const ops = result.map(item => ({
    updateOne: {
      filter: { name: item.name },
      update: { $set: { name: item.name, count: item.count } },
      upsert: true
    }
  }));
  if (ops.length > 0) {
    await CategoryStat.bulkWrite(ops, { ordered: false });
  }

  return result;
}

// Public: Get Category counts from cached DB collection (instant, no full collection scan)
app.get('/api/categories/stats', async (req, res) => {
  try {
    const cached = await CategoryStat.find({}, { _id: 0, name: 1, count: 1 }).lean();
    if (cached && cached.length > 0) {
      const general = cached.find(c => c.name === 'General') || { name: 'General', count: 0 };
      const others = cached
        .filter(c => c.name !== 'General')
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return res.json([general, ...others]);
    }

    // First-time initialization if CategoryStat collection is empty
    const result = await recomputeCategoryStats();
    res.json(result);
  } catch (err) {
    console.error("Category stats error:", err);
    res.status(500).json({ error: 'Failed to fetch category statistics' });
  }
});

// Public: Get Country video counts dynamically
app.get('/api/countries/stats', async (req, res) => {
  try {
    const COUNTRIES_DEF = [
      { code: 'ALL', name: 'All Countries', flag: '🌐' },
      { code: 'LK', name: 'Sri Lanka', flag: '🇱🇰' },
      { code: 'IN', name: 'India', flag: '🇮🇳' },
      { code: 'BD', name: 'Bangladesh', flag: '🇧🇩' },
      { code: 'PK', name: 'Pakistan', flag: '🇵🇰' },
      { code: 'NP', name: 'Nepal', flag: '🇳🇵' },
      { code: 'US', name: 'United States', flag: '🇺🇸' },
      { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
      { code: 'CA', name: 'Canada', flag: '🇨🇦' },
      { code: 'AU', name: 'Australia', flag: '🇦🇺' },
      { code: 'JP', name: 'Japan', flag: '🇯🇵' },
      { code: 'KR', name: 'Korea', flag: '🇰🇷' },
      { code: 'CN', name: 'China', flag: '🇨🇳' },
      { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
      { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
      { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
      { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
      { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
      { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
      { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
      { code: 'MM', name: 'Myanmar', flag: '🇲🇲' },
      { code: 'KH', name: 'Cambodia', flag: '🇰🇭' },
      { code: 'RU', name: 'Russia', flag: '🇷🇺' },
      { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
      { code: 'DE', name: 'Germany', flag: '🇩🇪' },
      { code: 'FR', name: 'France', flag: '🇫🇷' },
      { code: 'IT', name: 'Italy', flag: '🇮🇹' },
      { code: 'ES', name: 'Spain', flag: '🇪🇸' },
      { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
      { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
      { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
      { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
      { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
      { code: 'CL', name: 'Chile', flag: '🇨🇱' },
      { code: 'PE', name: 'Peru', flag: '🇵🇪' },
      { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
      { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
      { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
      { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
      { code: 'IR', name: 'Iran', flag: '🇮🇷' },
      { code: 'IQ', name: 'Iraq', flag: '🇮🇶' },
      { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
      { code: 'LB', name: 'Lebanon', flag: '🇱🇧' },
      { code: 'IL', name: 'Israel', flag: '🇮🇱' },
      { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
      { code: 'KW', name: 'Kuwait', flag: '🇰🇼' },
      { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
      { code: 'NG', name: 'Nigeria', flag: '🇳🇬' },
      { code: 'KE', name: 'Kenya', flag: '🇰🇪' },
      { code: 'GH', name: 'Ghana', flag: '🇬🇭' },
      { code: 'MA', name: 'Morocco', flag: '🇲🇦' },
      { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
      { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
      { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
      { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
      { code: 'NO', name: 'Norway', flag: '🇳🇴' },
      { code: 'FI', name: 'Finland', flag: '🇫🇮' },
      { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
      { code: 'PL', name: 'Poland', flag: '🇵🇱' },
      { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿' },
      { code: 'RO', name: 'Romania', flag: '🇷🇴' },
      { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
      { code: 'GR', name: 'Greece', flag: '🇬🇷' },
      { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
      { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
      { code: 'AT', name: 'Austria', flag: '🇦🇹' }
    ];

    const totalVideos = await Video.countDocuments({ isRemoved: { $ne: true } });

    // Aggregate real counts per country from DB
    const aggCounts = await Video.aggregate([
      { $match: { isRemoved: { $ne: true }, country: { $exists: true, $ne: '' } } },
      { $group: { _id: '$country', count: { $sum: 1 } } }
    ]);
    const countMap = {};
    aggCounts.forEach(item => {
      if (item._id) countMap[item._id.toUpperCase()] = item.count;
    });

    // Check if db has country codes not in predefined list
    const existingCodes = new Set(COUNTRIES_DEF.map(c => c.code));
    Object.keys(countMap).forEach(code => {
      if (!existingCodes.has(code)) {
        COUNTRIES_DEF.push({ code, name: code, flag: '🏳️' });
      }
    });

    const countryResults = COUNTRIES_DEF.filter(c => c.code !== 'ALL').map(c => ({
      ...c,
      count: countMap[c.code] || 0
    }));

    // Sort by count descending, then alphabetical
    const sorted = countryResults.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const result = [
      { code: 'ALL', name: 'All Countries', flag: '🌐', count: totalVideos },
      ...sorted
    ];

    res.json(result);
  } catch (err) {
    console.error("Country stats error:", err);
    res.status(500).json({ error: 'Failed to fetch country statistics' });
  }
});

// Public: Get latest videos grouped by categories for home sections
app.get('/api/categories/latest-sections', async (req, res) => {
  try {
    const CATEGORIES = [
      'Asian', 'Blowjob', 'Brunette', 'Big Tits', 'Hardcore', 'Amateur',
      'Cumshot', 'Blonde', 'Anal', 'Teen', 'Homemade', 'POV', 'MILF', 'Lesbian'
    ];

    const sections = await Promise.all(
      CATEGORIES.map(async (catName) => {
        const filter = {
          isRemoved: { $ne: true },
          $or: [
            { category: { $regex: catName, $options: 'i' } },
            { title: { $regex: catName, $options: 'i' } }
          ]
        };
        const latestVideos = await Video.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .limit(6);

        return {
          category: catName,
          videos: latestVideos
        };
      })
    );

    // Return only categories that actually have at least 1 video
    res.json(sections.filter(s => s.videos && s.videos.length > 0));
  } catch (err) {
    console.error("Latest category sections error:", err);
    res.status(500).json({ error: 'Failed to fetch category sections' });
  }
});

// ----------------------------------------------------
// PORNSTARS API ENDPOINTS
// ----------------------------------------------------

// Public: Get all pornstars (with real video count)
app.get('/api/pornstars', async (req, res) => {
  try {
    const pornstars = await Pornstar.find().sort({ createdAt: -1 });
    
    // Calculate actual video counts for each pornstar
    const result = await Promise.all(pornstars.map(async (star) => {
      const starObj = star.toJSON();
      const count = await Video.countDocuments({
        $or: [
          { pornstar: { $regex: new RegExp(`^${star.name}$`, 'i') } },
          { title: { $regex: star.name, $options: 'i' } }
        ],
        isRemoved: { $ne: true }
      });
      starObj.videoCount = count;
      return starObj;
    }));

    res.json(result);
  } catch (err) {
    console.error("Get pornstars error:", err);
    res.status(500).json({ error: 'Failed to fetch pornstars.' });
  }
});

// Public: Get single pornstar by slug or id + their videos
app.get('/api/pornstars/:slugOrId', async (req, res) => {
  try {
    const { slugOrId } = req.params;
    let star = null;
    if (mongoose.Types.ObjectId.isValid(slugOrId)) {
      star = await Pornstar.findById(slugOrId);
    }
    if (!star) {
      star = await Pornstar.findOne({ slug: slugOrId.toLowerCase().trim() });
    }
    if (!star) {
      return res.status(404).json({ error: 'Pornstar not found' });
    }

    const starObj = star.toJSON();
    // Fetch videos for this pornstar
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 24);
    const tag = (req.query.tag || '').trim();

    const videoFilter = {
      $or: [
        { pornstar: { $regex: new RegExp(`^${star.name}$`, 'i') } },
        { title: { $regex: star.name, $options: 'i' } }
      ],
      isRemoved: { $ne: true }
    };

    if (tag && tag.toLowerCase() !== 'all') {
      videoFilter.$and = [
        {
          $or: [
            { category: { $regex: tag, $options: 'i' } },
            { title: { $regex: tag, $options: 'i' } }
          ]
        }
      ];
    }

    const totalVideos = await Video.countDocuments(videoFilter);
    const videos = await Video.find(videoFilter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    starObj.videoCount = totalVideos;

    res.json({
      pornstar: starObj,
      videos,
      pagination: {
        page,
        limit,
        total: totalVideos,
        totalPages: Math.ceil(totalVideos / limit)
      }
    });
  } catch (err) {
    console.error("Get single pornstar error:", err);
    res.status(500).json({ error: 'Failed to fetch pornstar profile.' });
  }
});

// Admin: Create Pornstar
app.post('/api/admin/pornstars', authMiddleware, async (req, res) => {
  try {
    const { name, avatar, cover, description, followers, verified, socialLinks, tags } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const existing = await Pornstar.findOne({ $or: [{ name: name.trim() }, { slug }] });
    if (existing) {
      return res.status(400).json({ error: 'A pornstar with this name or slug already exists' });
    }

    const newStar = await Pornstar.create({
      name: name.trim(),
      slug,
      avatar: avatar || '',
      cover: cover || '',
      description: description || '',
      followers: followers || '10K',
      verified: verified !== undefined ? verified : true,
      socialLinks: socialLinks || {},
      tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : [])
    });

    res.status(201).json(newStar);
  } catch (err) {
    console.error("Create pornstar error:", err);
    res.status(500).json({ error: 'Failed to create pornstar' });
  }
});

// Admin: Update Pornstar
app.put('/api/admin/pornstars/:id', authMiddleware, async (req, res) => {
  try {
    const { name, avatar, cover, description, followers, verified, socialLinks, tags } = req.body;
    const updateData = {};
    if (name) {
      updateData.name = name.trim();
      updateData.slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
    if (avatar !== undefined) updateData.avatar = avatar;
    if (cover !== undefined) updateData.cover = cover;
    if (description !== undefined) updateData.description = description;
    if (followers !== undefined) updateData.followers = followers;
    if (verified !== undefined) updateData.verified = verified;
    if (socialLinks !== undefined) updateData.socialLinks = socialLinks;
    if (tags !== undefined) {
      updateData.tags = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : []);
    }

    const updated = await Pornstar.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!updated) {
      return res.status(404).json({ error: 'Pornstar not found' });
    }
    res.json(updated);
    recomputeCategoryStats().catch(e => console.error('CategoryStat sync error:', e));
  } catch (err) {
    console.error("Update pornstar error:", err);
    res.status(500).json({ error: 'Failed to update pornstar' });
  }
});

// Admin: Delete Pornstar
app.delete('/api/admin/pornstars/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await Pornstar.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Pornstar not found' });
    }
    res.json({ message: 'Pornstar deleted successfully' });
  } catch (err) {
    console.error("Delete pornstar error:", err);
    res.status(500).json({ error: 'Failed to delete pornstar' });
  }
});

// Public: Search suggestions / autocomplete by title
app.get('/api/videos/suggestions', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 1) {
      return res.json([]);
    }

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const videos = await Video.find({
      title: { $regex: regex },
      isRemoved: { $ne: true }
    })
      .select('title slug')
      .limit(8)
      .lean();

    res.json(videos.map(v => ({
      id: v._id,
      title: v.title,
      slug: v.slug
    })));
  } catch (err) {
    console.error("Suggestions error:", err);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// Public: Get single video by ID or Slug
app.get('/api/videos/:idOrSlug', async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    let video = null;

    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      video = await Video.findById(idOrSlug);
    }

    if (!video) {
      video = await Video.findOne({ slug: idOrSlug });
    }

    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }

    res.json(video);
  } catch (err) {
    console.error("Fetch video error:", err);
    res.status(500).json({ error: 'Failed to fetch video.' });
  }
});

// Public: Increment real view count when video is opened/played
app.post('/api/videos/:id/view', async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }
    res.json({ views: video.views, likes: video.likes || 0, dislikes: video.dislikes || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register view.' });
  }
});

// Public: React to video (like / dislike)
app.post('/api/videos/:id/react', async (req, res) => {
  try {
    const { action } = req.body; // 'like', 'unlike', 'dislike', 'undislike', 'like_from_dislike', 'dislike_from_like'
    let update = {};

    if (action === 'like') {
      update = { $inc: { likes: 1 } };
    } else if (action === 'unlike') {
      update = { $inc: { likes: -1 } };
    } else if (action === 'dislike') {
      update = { $inc: { dislikes: 1 } };
    } else if (action === 'undislike') {
      update = { $inc: { dislikes: -1 } };
    } else if (action === 'like_from_dislike') {
      update = { $inc: { likes: 1, dislikes: -1 } };
    } else if (action === 'dislike_from_like') {
      update = { $inc: { likes: -1, dislikes: 1 } };
    } else {
      return res.status(400).json({ error: 'Invalid reaction action.' });
    }

    const video = await Video.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }

    // Ensure non-negative numbers
    if (video.likes < 0) {
      video.likes = 0;
      await video.save();
    }
    if (video.dislikes < 0) {
      video.dislikes = 0;
      await video.save();
    }

    res.json({ likes: video.likes, dislikes: video.dislikes });
  } catch (err) {
    console.error("Reaction error:", err);
    res.status(500).json({ error: 'Failed to update reaction.' });
  }
});

// Admin: Bulk import videos from JSON (Upsert / Replace existing or Insert new)
app.post('/api/videos/bulk', authMiddleware, async (req, res) => {
  try {
    const { videos, defaultCountry = 'AUTO' } = req.body;

    if (!Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({ error: 'Please provide a non-empty array of videos.' });
    }

    // 1. Fetch all existing video records with their identifiers
    const existingVideos = await Video.find({}, { _id: 1, title: 1, link: 1, slug: 1, embedUrl: 1 }).lean();
    
    // Map existing videos by lowercase Title, Link, and Slug
    const existingByTitle = new Map();
    const existingByLink = new Map();
    const existingBySlug = new Map();

    for (const v of existingVideos) {
      if (v.title) existingByTitle.set(v.title.trim().toLowerCase(), v._id);
      if (v.link) existingByLink.set(v.link.trim().toLowerCase(), v._id);
      if (v.slug) existingBySlug.set(v.slug.trim().toLowerCase(), v._id);
    }

    const toInsert = [];
    const bulkUpdateOps = [];
    let updatedCount = 0;
    const batchSeenTitles = new Set();

    for (const item of videos) {
      const rawTitle = (item.title || '').trim();
      const lowerTitle = rawTitle.toLowerCase();
      if (!rawTitle) continue;

      // Skip in-batch duplicate rows if already processed
      if (batchSeenTitles.has(lowerTitle)) continue;
      batchSeenTitles.add(lowerTitle);

      const rawImage = (item.thumbnailUrl || item.image || item.thumbnail || '').trim();
      const rawLink = (item.pageUrl || item.link || item.url || '').trim();
      const rawStream = (item.streamUrl || item.videoUrl || item.sourceUrl || item.embedUrl || '').trim();
      const rawDuration = (item.duration || '').trim();
      const rawDescription = (item.description || '').trim();
      
      // Auto-detect country purely from Title
      const detectedCountry = detectCountry(rawTitle, rawLink, item.country || (defaultCountry !== 'ALL' && defaultCountry !== 'AUTO' && defaultCountry !== 'NONE' ? defaultCountry : ''));
      const rawCountry = detectedCountry;

      // Normalize embedUrls to JSON array string
      let finalEmbedUrl = '';
      if (rawStream) {
        if (rawStream.startsWith('[')) {
          finalEmbedUrl = rawStream;
        } else {
          finalEmbedUrl = JSON.stringify([rawStream]);
        }
      }

      const computedSlug = item.slug || generateSlug(rawLink, rawTitle);

      // Check if this video already exists in MongoDB
      const existingId = 
        existingByTitle.get(lowerTitle) ||
        (rawLink ? existingByLink.get(rawLink.toLowerCase()) : null) ||
        (computedSlug ? existingBySlug.get(computedSlug.toLowerCase()) : null);

      if (existingId) {
        // REPLACE / UPDATE EXISTING VIDEO DATA
        const updateFields = {
          title: rawTitle,
          country: rawCountry,
          slug: computedSlug
        };
        if (rawImage) updateFields.image = rawImage;
        if (rawLink) updateFields.link = rawLink;
        if (finalEmbedUrl) updateFields.embedUrl = finalEmbedUrl;
        if (rawDuration) updateFields.duration = rawDuration;
        if (rawDescription) updateFields.description = rawDescription;

        bulkUpdateOps.push({
          updateOne: {
            filter: { _id: existingId },
            update: { $set: updateFields }
          }
        });
        updatedCount++;
      } else {
        // INSERT AS NEW VIDEO
        toInsert.push({
          title: rawTitle,
          image: rawImage,
          link: rawLink,
          country: rawCountry,
          isRemoved: false,
          embedUrl: finalEmbedUrl,
          description: rawDescription,
          duration: rawDuration,
          slug: computedSlug,
          views: 0,
          likes: 0,
          dislikes: 0
        });
      }
    }

    // Execute bulk updates
    if (bulkUpdateOps.length > 0) {
      await Video.bulkWrite(bulkUpdateOps, { ordered: false });
    }

    // Execute new inserts
    let insertedCount = 0;
    if (toInsert.length > 0) {
      const insertedDocs = await Video.insertMany(toInsert, { ordered: false });
      insertedCount = insertedDocs.length;
    }

    res.json({
      success: true,
      totalReceived: videos.length,
      addedCount: insertedCount,
      updatedCount: updatedCount,
      skippedCount: 0
    });
    recomputeCategoryStats().catch(e => console.error('CategoryStat sync error:', e));
  } catch (err) {
    console.error("Bulk import/replace error:", err);
    res.status(500).json({ error: 'Failed to process videos.', details: err.message });
  }
});

// Admin: Create video
app.post('/api/videos', authMiddleware, async (req, res) => {
  try {
    const { title, image, link, country, category, pornstar, isRemoved, embedUrl, description, duration, slug } = req.body;
    const computedSlug = slug || generateSlug(link, title);
    const finalCountry = country ? country.trim().toUpperCase() : detectCountry(title, link);

    const newVideo = await Video.create({
      title,
      image: image || '',
      link: link || '',
      country: finalCountry,
      category: category || 'General',
      pornstar: pornstar ? pornstar.trim() : '',
      isRemoved: Boolean(isRemoved),
      embedUrl: embedUrl || '',
      description: description || '',
      duration: duration || '',
      slug: computedSlug
    });
    res.status(201).json(newVideo);
    recomputeCategoryStats().catch(e => console.error('CategoryStat sync error:', e));
  } catch (err) {
    console.error("Create video error:", err);
    res.status(500).json({ error: 'Failed to create video.' });
  }
});

// Admin: Update video
app.put('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    const { title, image, link, country, category, pornstar, isRemoved, embedUrl, description, duration, slug } = req.body;
    const computedSlug = slug || generateSlug(link, title);

    const updated = await Video.findByIdAndUpdate(
      req.params.id,
      {
        title,
        image,
        link,
        country,
        category: category || 'General',
        pornstar: pornstar !== undefined ? pornstar.trim() : '',
        isRemoved: Boolean(isRemoved),
        embedUrl,
        description: description || '',
        duration: duration || '',
        slug: computedSlug
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Video not found.' });
    }
    res.json(updated);
    recomputeCategoryStats().catch(e => console.error('CategoryStat sync error:', e));
  } catch (err) {
    console.error("Update video error:", err);
    res.status(500).json({ error: 'Failed to update video.' });
  }
});

// Admin: Delete video
app.delete('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await Video.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Video not found.' });
    }
    res.json({ success: true, message: 'Video deleted.' });
    recomputeCategoryStats().catch(e => console.error('CategoryStat sync error:', e));
  } catch (err) {
    console.error("Delete video error:", err);
    res.status(500).json({ error: 'Failed to delete video.' });
  }
});

// ==================== REPORTS ====================

// Public: Submit report
app.post('/api/reports', async (req, res) => {
  try {
    const { videoId, videoTitle, reason, captchaToken } = req.body;
    const finalReason = reason || (captchaToken && captchaToken.startsWith('reason:') ? captchaToken.replace('reason:', '') : (captchaToken || 'Broken Link'));
    const report = await Report.create({
      videoId,
      videoTitle,
      reason: finalReason,
      captchaToken: captchaToken || '',
      status: 'pending'
    });
    res.status(201).json(report);
  } catch (err) {
    console.error("Submit report error:", err);
    res.status(500).json({ error: 'Failed to submit report.' });
  }
});

// Admin: Get all reports
app.get('/api/reports', authMiddleware, async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    console.error("Get reports error:", err);
    res.status(500).json({ error: 'Failed to fetch reports.' });
  }
});

// Admin: Delete report
app.delete('/api/reports/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await Report.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Report not found.' });
    }
    res.json({ success: true, message: 'Report deleted.' });
  } catch (err) {
    console.error("Delete report error:", err);
    res.status(500).json({ error: 'Failed to delete report.' });
  }
});

// ----------------------------------------------------
// 5. START SERVER
// ----------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Pink Horse API running on http://localhost:${PORT}`);
});
