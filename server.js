import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import slugify from 'slugify';

dotenv.config();

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/oxenora_ai_drama';
const JWT_SECRET = process.env.JWT_SECRET || 'oxenora_super_secret_jwt_key_2026_ai_short_drama';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// =========================================================
// 1. MONGODB DATABASE CONNECTION
// =========================================================
mongoose.set('strictQuery', false);

async function connectDB() {
  try {
    const conn = await mongoose.connect(MONGODB_URI);
    console.log(`[MongoDB] Connected to isolated DB: ${conn.connection.name} @ ${conn.connection.host}`);
    await ensureAdminUser();
  } catch (error) {
    console.error(`[MongoDB Error] Failed to connect: ${error.message}`);
    console.log('[Notice] Running in mock/offline mode if MongoDB is not locally running.');
  }
}

// =========================================================
// 2. MONGOOSE SCHEMAS & MODELS
// =========================================================
const episodeSchema = new mongoose.Schema({
  episodeNumber: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  videoUrl: { type: String, required: true },
  duration: { type: Number, default: 90 }, // seconds (typically 60-120s)
  thumbnail: { type: String, default: '' },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  isFree: { type: Boolean, default: true }
});

const dramaSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    tagline: { type: String, default: '' },
    description: { type: String, required: true },
    posterUrl: { type: String, required: true },
    bannerUrl: { type: String, default: '' },
    trailerUrl: { type: String, default: '' },
    categories: [{ type: String, index: true }],
    tags: [{ type: String }],
    status: { type: String, enum: ['Ongoing', 'Completed'], default: 'Completed' },
    isFeatured: { type: Boolean, default: false },
    isTrending: { type: Boolean, default: false },
    rating: { type: Number, default: 4.9 },
    totalEpisodes: { type: Number, default: 1 },
    episodes: [episodeSchema],
    totalViews: { type: Number, default: 0 },
    // SEO fields
    metaTitle: { type: String },
    metaDescription: { type: String },
    keywords: [{ type: String }],
    releaseDate: { type: Date, default: Date.now },
    cast: [{ type: String }]
  },
  { timestamps: true }
);

dramaSchema.index({ title: 'text', description: 'text', tags: 'text' });
const Drama = mongoose.models.Drama || mongoose.model('Drama', dramaSchema);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'editor', 'user'], default: 'user' },
    avatar: { type: String, default: '' },
    watchlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Drama' }]
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.models.User || mongoose.model('User', userSchema);

async function ensureAdminUser() {
  try {
    const adminEmail = (process.env.ADMIN_EMAIL || 'chamikasanjan03@gmail.com').toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'Chamika123@';
    
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      admin = await User.create({
        name: 'Chamika Sanjan (Super Admin)',
        email: adminEmail,
        password: adminPassword,
        role: 'admin'
      });
      console.log(`[Auth] Default Admin account created: ${adminEmail}`);
    } else {
      // Ensure role is admin
      if (admin.role !== 'admin') {
        admin.role = 'admin';
        await admin.save();
      }
    }
  } catch (err) {
    console.error('[Admin Setup Notice]', err.message);
  }
}

// =========================================================
// 3. AUTH & HELPER MIDDLEWARE
// =========================================================
const generateToken = (id) => {
  return jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
};

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }
  }
  return res.status(401).json({ success: false, message: 'Not authorized, no token provided' });
};

const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'editor')) {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Admin privilege required' });
  }
};

// =========================================================
// 4. EXPRESS APP SETUP
// =========================================================
const app = express();

// Full CORS Header Support
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    platform: 'Oxenora AI Short Drama API (Single Server Engine)',
    database: 'oxenora_ai_drama (Isolated DB)',
    timestamp: new Date().toISOString()
  });
});

// =========================================================
// 6. AUTH ROUTES
// =========================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    const count = await User.countDocuments();
    const role = count === 0 ? 'admin' : 'user';
    const user = await User.create({ name, email, password, role });
    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user._id)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
      res.json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          token: generateToken(user._id)
        }
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/auth/me', protect, async (req, res) => {
  res.json({ success: true, data: req.user });
});

// =========================================================
// 7. DRAMA API ROUTES
// =========================================================
app.get('/api/dramas', async (req, res) => {
  try {
    const { category, search, trending, featured, page = 1, limit = 20 } = req.query;
    const query = {};

    if (category) {
      query.categories = { $in: [new RegExp(category, 'i')] };
    }
    if (trending === 'true') {
      query.isTrending = true;
    }
    if (featured === 'true') {
      query.isFeatured = true;
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } }
      ];
    }

    const dramas = await Drama.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Drama.countDocuments(query);

    res.json({
      success: true,
      count: dramas.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      data: dramas
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/dramas/:slug', async (req, res) => {
  try {
    const drama = await Drama.findOne({ slug: req.params.slug });
    if (!drama) {
      return res.status(404).json({ success: false, message: 'Drama not found' });
    }
    drama.totalViews += 1;
    await drama.save();
    res.json({ success: true, data: drama });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/dramas', protect, adminOnly, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const dramaData = { ...req.body };
    delete dramaData._id; // Prevent any invalid ObjectId casting error

    let baseSlug = slugify(title, { lower: true, strict: true }) || 'series';
    let slug = baseSlug;
    let counter = 1;
    while (await Drama.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const drama = await Drama.create({
      ...dramaData,
      slug,
      metaTitle: dramaData.metaTitle || `${title} - Watch AI Short Drama Free Online | Oxenora`,
      metaDescription: dramaData.metaDescription || (dramaData.description ? dramaData.description.slice(0, 155) : '')
    });

    res.status(201).json({ success: true, data: drama });
  } catch (error) {
    console.error('[Drama Create Error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/dramas/:id', protect, adminOnly, async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (updateData.episodes && Array.isArray(updateData.episodes)) {
      updateData.totalEpisodes = updateData.episodes.length;
      if (updateData.episodes.length > 0 && updateData.episodes[0].videoUrl) {
        updateData.trailerUrl = updateData.episodes[0].videoUrl;
      }
    }
    const drama = await Drama.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!drama) return res.status(404).json({ success: false, message: 'Drama not found' });
    res.json({ success: true, data: drama });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/dramas/:id', protect, adminOnly, async (req, res) => {
  try {
    const drama = await Drama.findByIdAndDelete(req.params.id);
    if (!drama) return res.status(404).json({ success: false, message: 'Drama not found' });
    res.json({ success: true, message: 'Drama removed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Episodes Management
app.post('/api/dramas/:id/episodes', protect, adminOnly, async (req, res) => {
  try {
    const drama = await Drama.findById(req.params.id);
    if (!drama) return res.status(404).json({ success: false, message: 'Drama not found' });

    drama.episodes.push(req.body);
    drama.totalEpisodes = drama.episodes.length;
    await drama.save();

    res.status(201).json({ success: true, data: drama });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/dramas/:id/episodes/:episodeId', protect, adminOnly, async (req, res) => {
  try {
    const drama = await Drama.findById(req.params.id);
    if (!drama) return res.status(404).json({ success: false, message: 'Drama not found' });

    drama.episodes = drama.episodes.filter(ep => ep._id.toString() !== req.params.episodeId);
    drama.totalEpisodes = drama.episodes.length;
    await drama.save();

    res.json({ success: true, data: drama });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Interactions
app.post('/api/dramas/:id/views', async (req, res) => {
  try {
    const drama = await Drama.findByIdAndUpdate(req.params.id, { $inc: { totalViews: 1 } }, { new: true });
    res.json({ success: true, totalViews: drama?.totalViews || 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Analytics Dashboard Endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    const totalDramas = await Drama.countDocuments();
    const dramas = await Drama.find();
    const totalEpisodes = dramas.reduce((acc, d) => acc + (d.episodes ? d.episodes.length : 0), 0);
    const totalViews = dramas.reduce((acc, d) => acc + (d.totalViews || 0), 0);
    const featuredCount = await Drama.countDocuments({ isFeatured: true });

    const categoryStats = {};
    dramas.forEach(d => {
      (d.categories || []).forEach(c => {
        categoryStats[c] = (categoryStats[c] || 0) + 1;
      });
    });

    res.json({
      success: true,
      data: {
        totalDramas,
        totalEpisodes,
        totalViews,
        featuredCount,
        categoryStats,
        topTrending: dramas.sort((a, b) => b.totalViews - a.totalViews).slice(0, 5)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================
// 8. DYNAMIC SEO SITEMAP & ROBOTS.TXT
// =========================================================
app.get('/api/seo/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = FRONTEND_URL;
    const dramas = await Drama.find().select('slug updatedAt').sort({ updatedAt: -1 });

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <url><loc>${baseUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/explore</loc><changefreq>daily</changefreq><priority>0.9</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/trending</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>\n`;

    dramas.forEach((drama) => {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/watch/${drama.slug}</loc>\n`;
      xml += `    <lastmod>${new Date(drama.updatedAt).toISOString()}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.8</priority>\n`;
      xml += `  </url>\n`;
    });

    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (error) {
    res.status(500).send('Error generating sitemap');
  }
});

app.get('/robots.txt', (req, res) => {
  const robots = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${FRONTEND_URL}/api/seo/sitemap.xml\n`;
  res.type('text/plain');
  res.send(robots);
});

// Global Error Handler & Crash Protection
app.use((err, req, res, next) => {
  console.error('[Express Global Error]', err);
  res.header('Access-Control-Allow-Origin', '*');
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

// =========================================================
// 9. START SERVER
// =========================================================
app.listen(PORT, async () => {
  await connectDB();
  console.log(`\n======================================================`);
  console.log(`  🎬 Oxenora AI Short Drama API (Single Server File) `);
  console.log(`  🌐 Server:       http://localhost:${PORT}`);
  console.log(`  📦 Database:     ${MONGODB_URI}`);
  console.log(`  🗺️ Dynamic SEO:  http://localhost:${PORT}/api/seo/sitemap.xml`);
  console.log(`  ❤️ Health Check: http://localhost:${PORT}/api/health`);
  console.log(`======================================================\n`);
});

export default app;

