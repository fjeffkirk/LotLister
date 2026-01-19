# LotLister

A web application for managing trading card lots - upload photos, organize cards, and export to eBay File Exchange format or raw CSV.

## Features

- **Lot Management**: Create, view, and delete lots
- **Photo Import**: Drag & drop multiple images with automatic card grouping
- **Smart Grouping**: Automatically pairs images (front/back) into card rows
- **Excel-like Grid Editor**: Edit card details with inline editing, dropdowns, and keyboard navigation
- **Dual View Modes**:
  - **Overview**: Title, Status, Sale Price, Category, Year, Brand, Set
  - **Inspector**: Name, Card #, Subset/Parallel, Attributes, Team, Variation, Graded, Grader, Condition, Cert No.
- **Export Options**:
  - eBay File Exchange CSV (ready for bulk upload)
  - Raw CSV (all fields as-is)
- **Export Settings**: Configure eBay listing defaults (auction type, pricing, shipping, returns, scheduling with stagger)

## Tech Stack

- **Framework**: Next.js 14 (App Router) + TypeScript
- **Styling**: TailwindCSS
- **Database**: SQLite with Prisma ORM
- **Grid**: AG Grid Community
- **Image Processing**: Sharp (for thumbnails)
- **Validation**: Zod

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Create database and run migrations
npm run db:push

# Start development server
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000)

### Database Commands

```bash
# Generate Prisma client after schema changes
npm run db:generate

# Push schema changes to database
npm run db:push

# Run migrations (for production)
npm run db:migrate

# Open Prisma Studio (database GUI)
npm run db:studio
```

## File Storage

Uploaded images are stored locally in the `./data/uploads/` directory:

```
data/
├── lotlister.sqlite          # SQLite database
└── uploads/
    └── {lotId}/
        ├── image1_timestamp.jpg
        ├── image2_timestamp.jpg
        └── thumbs/
            ├── thumb_image1_timestamp.jpg
            └── thumb_image2_timestamp.jpg
```

The storage layer is abstracted (`lib/storage.ts`) for easy migration to S3 or other cloud storage.

## Usage Workflow

### 1. Create a Lot
- Go to `/lots`
- Click "New Lot"
- Enter a name (e.g., "2024 Topps Baseball")

### 2. Import Photos
- Open the lot
- Click "Import"
- Drag & drop photos or click to select
- Choose "Images per card" (default: 2 for front/back)
- Review grouping preview
- Click "Import"

### 3. Edit Card Details
- Use **Overview** mode for commerce fields (Title, Price, Category)
- Use **Inspector** mode for card details (Name, Card #, Team)
- Click cells to edit, use Tab/Enter to navigate
- Changes auto-save after 500ms

### 4. Configure Export Settings
- Click "Settings" button
- Configure eBay listing defaults:
  - Listing type (Auction/Buy It Now)
  - Start price, duration
  - Schedule date/time with stagger interval
  - Shipping service and costs
  - Returns policy
  - Item location

### 5. Export
- Click "Export" dropdown
- Choose:
  - **eBay File Exchange CSV**: Ready for eBay bulk upload
  - **Raw CSV**: All fields including image paths

## Image Grouping Algorithm

Images are grouped into cards using this algorithm:

1. **Sort by filename** (natural sort, e.g., `card01a.jpg`, `card01b.jpg`)
2. **Group sequentially** based on "Images per card" setting:
   - Images 1-2 → Card 1
   - Images 3-4 → Card 2
   - etc.

### Changing Grouping
- During import: Change "Images per card" dropdown
- The grouping preview updates in real-time
- Images at the end that don't fill a complete group become partial cards

## eBay Export Format

The eBay CSV export follows the File Exchange template format:

- First row: Action header with site/currency info
- Second row: Column headers
- Data rows: One per card item

### Key Mappings
- **ConditionID**: 2750 (Graded) or 4000 (Ungraded)
- **Format**: "Auction" or "FixedPrice"
- **ScheduleTime**: Auto-calculated with stagger if enabled
- **Title**: Auto-generated from card fields if blank

### Schedule Staggering
When stagger is enabled:
- Card 1: baseDateTime
- Card 2: baseDateTime + staggerInterval
- Card 3: baseDateTime + (2 × staggerInterval)
- etc.

## Data Model

### Lot
- `id`: UUID
- `name`: String
- `createdAt`, `updatedAt`: DateTime

### CardItem
**Overview Fields:**
- `title`: Auto-generated or custom
- `status`: Draft, Ready, Exported
- `salePrice`: Number
- `category`: String (Baseball, Basketball, etc.)
- `year`, `brand`, `setName`: String/Number

**Inspector Fields:**
- `name`: Player name
- `cardNumber`: Card #
- `subsetParallel`: Subset/Parallel name
- `attributes`: Free text
- `team`: Team name
- `variation`: Variation info
- `graded`: Boolean
- `grader`: PSA, BGS, SGC, etc.
- `condition`: Near Mint or Better, Excellent, etc.
- `certNo`: Certification number

### CardImage
- `originalPath`: Path to original image
- `thumbPath`: Path to thumbnail
- `filename`: Original filename
- `sortOrder`: Order within card

### ExportProfile
Full eBay listing configuration including category, pricing, shipping, returns, and scheduling options.

## Environment Variables

Currently none required. The database path is configured in `prisma/schema.prisma`.

## License

MIT
