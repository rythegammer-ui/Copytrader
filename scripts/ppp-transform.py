"""Turn the PPP Master Inventory workbook into data/ppp-catalog.json.

Every mapping decision lives here and is explicit, so the importer stays dumb
and the result is reproducible. Run from the repo root:
    python3 transform.py <workbook.xlsx> data/ppp-catalog.json
"""
import json, re, sys
import pandas as pd

SRC, OUT = sys.argv[1], sys.argv[2]

# The shop-stock rows arrive as raw eBay-style keyword soup with a unit cost
# and no retail price, so they cannot be mapped by table lookup the way the
# part-out rows can. data/ppp-shop-overrides.json carries the reviewed
# per-row decision (clean title, category, fitment, price, labour) and is
# applied on top of the mechanical mapping below. Absent, shop rows keep the
# mechanical result and stay unlisted.
import os
OVERRIDES = {}
_ov_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                        "data", "ppp-shop-overrides.json")
if os.path.exists(_ov_path):
    OVERRIDES = {r["id"]: r for r in json.load(open(_ov_path))["rows"]}

# The shop bins and the part-out trackers were built separately and overlap:
# the same physical climate panel can appear as a shop row and a 528i row.
# data/ppp-duplicates.json records which side to keep so one unit is never
# listed twice. Each entry is {"suppress": "F17", "keep": "S4", "reason": ...}.
DUPLICATES = {}
_dup_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                         "data", "ppp-duplicates.json")
if os.path.exists(_dup_path):
    DUPLICATES = {d["suppress"]: d for d in json.load(open(_dup_path))["pairs"]}

# --- price semantics -------------------------------------------------------
# "Ask $ (line)" is a LOT price: F47 is four doors for $1,120 total, not each.
# So a part-out row becomes ONE product at the ask price with one lot in stock.
# Shop-stock rows are the opposite: Qty is a real unit count and the only money
# column is unit cost — the sheet says "no asks yet", so they import UNPRICED.

def cents(v):
    return None if v is None or pd.isna(v) else int(round(float(v) * 100))

def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return s or None

# --- vehicle fitment -------------------------------------------------------
# (make, model, yearFrom, yearTo, engine|None). Years are the generation's US
# production span; engine set only where the platform names one.
N20_APPS = [("BMW", "5 Series", 2012, 2016, "N20 2.0L Turbo I4"),
            ("BMW", "3 Series", 2012, 2016, "N20 2.0L Turbo I4"),
            ("BMW", "4 Series", 2014, 2016, "N20 2.0L Turbo I4"),
            ("BMW", "X3", 2013, 2017, "N20 2.0L Turbo I4")]
N54_APPS = [("BMW", "3 Series", 2007, 2013, "N54 3.0L Twin-Turbo I6"),
            ("BMW", "5 Series", 2008, 2010, "N54 3.0L Twin-Turbo I6"),
            ("BMW", "1 Series", 2008, 2013, "N54 3.0L Twin-Turbo I6")]
N55_APPS = [("BMW", "3 Series", 2011, 2015, "N55 3.0L Turbo I6"),
            ("BMW", "5 Series", 2011, 2016, "N55 3.0L Turbo I6")]
S55_APPS = [("BMW", "3 Series", 2015, 2018, "S55 3.0L Twin-Turbo I6"),
            ("BMW", "4 Series", 2015, 2020, "S55 3.0L Twin-Turbo I6")]
B58_APPS = [("Toyota", "Supra", 2020, 2026, "B58 3.0L Turbo I6"),
            ("BMW", "3 Series", 2016, 2018, "B58 3.0L Turbo I6"),
            ("BMW", "5 Series", 2017, 2023, "B58 3.0L Turbo I6")]
B46_APPS = [("BMW", "3 Series", 2016, 2019, "B46 2.0L Turbo I4"),
            ("BMW", "4 Series", 2017, 2020, "B46 2.0L Turbo I4")]

TOKENS = {
    "F10 528i (N20)": [("BMW", "5 Series", 2012, 2016, "N20 2.0L Turbo I4")],
    "E90 335i (N54)": [("BMW", "3 Series", 2007, 2010, "N54 3.0L Twin-Turbo I6")],
    "N20 (2012-16)": N20_APPS,
    "N20": N20_APPS,
    "N54": N54_APPS,
    "N55": N55_APPS,
    "S55": S55_APPS,
    "B58": B58_APPS,
    "B46": B46_APPS,
    "N52/N51": [("BMW", "3 Series", 2006, 2013, "N52 3.0L I6"),
                ("BMW", "5 Series", 2006, 2010, "N52 3.0L I6")],
    "F10 5-series": [("BMW", "5 Series", 2011, 2016, None)],
    "G30 5-series": [("BMW", "5 Series", 2017, 2023, None)],
    "E60 5-series": [("BMW", "5 Series", 2004, 2010, None)],
    "5-series": [("BMW", "5 Series", 2004, 2023, None)],
    "F07 5GT": [("BMW", "5 Series GT", 2010, 2017, None)],
    "E9x 3-series": [("BMW", "3 Series", 2006, 2013, None)],
    "F30/F3x 3-4 series": [("BMW", "3 Series", 2012, 2019, None),
                           ("BMW", "4 Series", 2014, 2020, None)],
    "3-series": [("BMW", "3 Series", 2006, 2019, None)],
    "F06/F12/F13 6-series": [("BMW", "6 Series", 2012, 2018, None)],
    "F01 7-series": [("BMW", "7 Series", 2009, 2015, None)],
    "F25 X3": [("BMW", "X3", 2011, 2017, None)],
    "E83 X3": [("BMW", "X3", 2004, 2010, None)],
    "S1000RR (moto)": [("BMW Motorrad", "S1000RR", 2010, 2026, None)],
    "Toyota Supra (B58)": [("Toyota", "Supra", 2020, 2026, "B58 3.0L Turbo I6")],
    "Ford Fusion": [("Ford", "Fusion", 2006, 2020, None)],
    "Buick Regal": [("Buick", "Regal", 2011, 2020, None)],
    "Chevy Camaro": [("Chevrolet", "Camaro", 2010, 2024, None)],
    "Jeep Grand Cherokee": [("Jeep", "Grand Cherokee", 2011, 2021, None)],
    "Porsche Macan": [("Porsche", "Macan", 2015, 2024, None)],
}
# The source car behind each part-out, used when a row names no platform.
SOURCE_FALLBACK = {
    "F10 528i Part-Out": TOKENS["F10 528i (N20)"],
    "E90 335i Part-Out": TOKENS["E90 335i (N54)"],
    "N20 Motor Part-Out": N20_APPS,
}
SOURCE_CAR = {
    "F10 528i Part-Out": "2013 BMW 528i (F10, N20)",
    "E90 335i Part-Out": "2010 BMW 335i (E90, N54)",
    "N20 Motor Part-Out": "N20 engine part-out",
    "Shop Stock": "shop stock",
}

def fitments_for(platform, source):
    raw = clean(platform)
    if not raw:
        return list(SOURCE_FALLBACK.get(source, []))
    out, unknown = [], []
    for tok in [t.strip() for t in raw.split(",") if t.strip()]:
        if tok in TOKENS:
            out.extend(TOKENS[tok])
        else:
            unknown.append(tok)
    if unknown:
        UNMAPPED.update(unknown)
    if not out:
        out = list(SOURCE_FALLBACK.get(source, []))
    seen, uniq = set(), []
    for f in out:
        if f not in seen:
            seen.add(f); uniq.append(f)
    return uniq

UNMAPPED = set()

# --- categories ------------------------------------------------------------
CATEGORY = {
    "Interior": "interior", "Electrical / modules": "electrical",
    "Electrical / sensors": "electrical", "Electronics": "audio-electronics",
    "Audio": "audio-electronics", "Body / exterior": "body-exterior",
    "Exterior": "body-exterior", "Front clip": "body-exterior",
    "Cooling": "cooling", "Cylinder head / valvetrain": "engine",
    "Engine & Performance": "engine", "Engine (KEEP)": "engine",
    "Engine bay": "engine", "Oiling": "engine", "Turbo": "engine",
    "Do not sell": "engine", "Intake": "fuel-air", "Fuel / ignition": "ignition",
    "Brakes": "brakes", "Front Suspension": "suspension",
    "Rear Suspension (Passenger)": "suspension", "Suspension": "suspension",
    "Drivetrain": "drivetrain", "Exhaust": "exhaust",
    "Shop fluids": "shop-supplies", "Shop supplies": "shop-supplies",
    "Hardware": "shop-supplies",
}
# Keyword routing for the buckets the sheet leaves broad.
KEYWORDS = [
    (r"headlight|head lamp|tail lamp|taillight|fog|turn signal|led|xenon|halogen", "lighting"),
    (r"wheel|tire|tpms", "wheels-tires"),
    (r"brake|caliper|rotor|abs ", "brakes"),
    (r"transmission|differential|driveshaft|half shaft|axle|clutch|torque converter", "drivetrain"),
    (r"exhaust|muffler|downpipe|catalytic|cat\b", "exhaust"),
    (r"radiator|condenser|coolant|water pump|thermostat|cooling fan|expansion tank", "cooling"),
    (r"hvac|heater core|evaporator|a/c|ac compressor|blower|climate", "hvac"),
    (r"fuel|injector|hpfp|intake|airbox|air filter|maf|mass air|throttle|manifold|evap", "fuel-air"),
    (r"spark plug|ignition coil|coil pack", "ignition"),
    (r"seat|dash|console|trim|carpet|door panel|headliner|glove box|steering wheel|mirror|visor|shifter", "interior"),
    (r"suspension|strut|shock|control arm|sway bar|subframe|knuckle|spring|coilover|steering rack|tie rod", "suspension"),
    (r"bumper|fender|hood|trunk|door|grille|spoiler|skirt|panel|glass|windshield|weather strip", "body-exterior"),
    (r"radio|amplifier|speaker|subwoofer|head unit|navigation|idrive|cluster|screen|display", "audio-electronics"),
    (r"module|sensor|switch|harness|relay|fuse|battery|alternator|starter|dme|ecu|cas\b|frm", "electrical"),
    (r"oil filter|filter", "filters"),
    (r"glove|brake clean|shop towel|rag|oil |atf|fluid|coolant|grease|sealant", "shop-supplies"),
    (r"turbo|supercharger|intercooler|charge pipe|catch can|tune|jb4", "engine"),
]

def category_for(row):
    name = (str(row["Part"]) or "").lower()
    src_cat = clean(row["Category"])
    # Broad buckets get routed by what the part actually is.
    if src_cat in ("Hard part", "Accessories", "Wheels / brakes / suspension",
                   "Exhaust / drivetrain", "Fuel / HVAC", None):
        for pat, slug in KEYWORDS:
            if re.search(pat, name):
                return slug
        return {"Wheels / brakes / suspension": "wheels-tires",
                "Exhaust / drivetrain": "drivetrain",
                "Fuel / HVAC": "fuel-air"}.get(src_cat, "accessories")
    return CATEGORY.get(src_cat, "accessories")

# --- installation ----------------------------------------------------------
# Labor in tenths of an hour, by destination category; big jobs override.
LABOR = {"brakes": 15, "suspension": 25, "cooling": 20, "engine": 30,
         "electrical": 10, "exhaust": 15, "drivetrain": 50, "body-exterior": 20,
         "interior": 10, "wheels-tires": 10, "lighting": 8,
         "audio-electronics": 10, "fuel-air": 15, "hvac": 40, "ignition": 8,
         "filters": 5, "accessories": 10}
LABOR_OVERRIDE = [
    (r"transmission|torque converter", 60), (r"long block|complete engine|engine, complete", 120),
    (r"subframe|crossmember", 50), (r"hvac box|evaporator|heater core", 60),
    (r"cylinder head", 60), (r"turbocharger|turbo kit", 45),
    (r"wiring harness", 40), (r"differential", 35), (r"steering rack", 30),
    (r"fuel tank", 30), (r"driveshaft", 20), (r"doors, complete", 40),
]
NOT_INSTALLABLE = re.compile(
    r"bolt bucket|heat shield|hardware|glove|brake clean|shop towel|fluid|"
    r"\batf\b|oil - |jug|spray|sealant|gasket|belts and hoses|brackets", re.I)

def install_for(name, slug):
    if slug == "shop-supplies" or NOT_INSTALLABLE.search(name):
        return False, 0
    tenths = LABOR.get(slug, 10)
    for pat, t in LABOR_OVERRIDE:
        if re.search(pat, name, re.I):
            tenths = t
            break
    return True, tenths

WEIGHT = {"body-exterior": 15000, "drivetrain": 30000, "engine": 12000,
          "suspension": 8000, "wheels-tires": 12000, "cooling": 5000,
          "hvac": 8000, "interior": 3000}

# --- rows ------------------------------------------------------------------
df = pd.read_excel(SRC, sheet_name="Master")
df.columns = [str(c).strip() for c in df.columns]

SELLABLE_STATUS = {"Pulled", "On Car", "On Engine"}
NEVER_LIST_STATUS = {"Keep for Swap", "Do Not Sell", "Scrap", "Sold",
                     "Out of Stock", "Undecided"}
NEVER_LIST_CHANNEL = {"Keep", "Scrap"}
LOCAL_CHANNEL = {"Local", "Recycler/Local"}

def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")[:70]

parts, seen_slugs = [], {}
# Channel "Bundle-*" marks a row as a piece of a package the shop lists as one
# item. Collected here so the bundle product can be linked to its pieces and
# the two can never be sold twice over.
bundle_members = {}
for _, row in df.iterrows():
    ref = clean(row["ID"])
    if not ref:
        continue
    name = clean(row["Part"]) or ref
    source = clean(row["Source"]) or "Shop Stock"
    status = clean(row["Status"]) or "In Stock"
    channel = clean(row["Channel"])
    is_shop = source == "Shop Stock"

    ask, floor = cents(row["Ask $ (line)"]), cents(row["Floor $"])
    cost = cents(row["Cost $ (unit)"])
    qty = row["Qty"]
    qty = 0 if pd.isna(qty) else int(qty)

    # Part-out lots price at the line ask and sell as one unit; shop stock
    # keeps its real unit count but has no retail price in the export.
    if is_shop:
        price = cost or 0
        stock_qty = qty
        needs_price = True
    else:
        price = ask or 0
        stock_qty = 0 if status in ("Sold", "Out of Stock") else 1
        needs_price = price == 0

    listable = (
        status in SELLABLE_STATUS
        and channel not in NEVER_LIST_CHANNEL
        and clean(row["Category"]) != "Do not sell"
        and price > 0
        and stock_qty > 0
    )

    desc_raw = clean(row["Condition / Description"])
    tags = re.findall(r"\[([^\]]+)\]", desc_raw or "")
    public = re.sub(r"\s*\[[^\]]+\]", "", desc_raw or "").strip() or None
    local_pickup = channel in LOCAL_CHANNEL or any(t.lower() == "local pickup" for t in tags)
    accepts_offers = any(t.lower() == "obo" for t in tags)

    pn = clean(row["Part Number"])
    bits = []
    if public:
        bits.append(public)
    elif is_shop:
        bits.append(f"{name}. In stock at our shop.")
    else:
        bits.append(f"{name}, removed from our {SOURCE_CAR.get(source, 'part-out')}.")
    if not is_shop:
        bits.append("Used OEM part, sold as-is.")
        if status in ("On Car", "On Engine"):
            bits.append("Still on the vehicle — allow a few days for removal after you order.")
    if pn:
        bits.append(f"Part number: {pn}.")
    if local_pickup:
        bits.append("Local pickup at our shop — this item is not shipped.")
    if accepts_offers:
        bits.append("Open to offers.")
    bits.append("Message us for photos or fitment questions.")
    description = " ".join(bits)

    slug = slugify(f"{name}-{ref}")
    if slug in seen_slugs:
        slug = f"{slug}-{ref.lower()}"
    seen_slugs[slug] = True

    cat = category_for(row)
    installable, tenths = install_for(name, cat)
    notes = clean(row["Notes / Flags"])
    internal = []
    if notes:
        internal.append(notes)
    if needs_price and is_shop:
        internal.append(
            f"PRICE NOT SET — ${(cost or 0)/100:.2f} is the cost basis from the shop export, "
            "not a retail price. Set a retail price before listing.")
    if not listable:
        internal.append(f"Not listed: status {status}" + (f", channel {channel}" if channel else "") + ".")
    if clean(row["Comp / Price basis"]):
        internal.append(f"Price basis: {clean(row['Comp / Price basis'])}.")
    if clean(row["eBay Low $"]) or clean(row["eBay High $"]):
        internal.append(f"eBay comps: ${row['eBay Low $']}-${row['eBay High $']}.")
    if qty > 1 and not is_shop:
        internal.append(f"Lot of {qty} pieces sold as one unit at the line ask.")

    if (channel or "").startswith("Bundle-"):
        bundle_members.setdefault(channel, []).append(ref)

    parts.append({
        "sourceRef": ref, "sku": f"PPP-{ref}", "slug": slug, "name": name,
        "description": description,
        "internalNotes": " ".join(internal) or None,
        "categorySlug": cat,
        "brandName": clean(row["Brand"]) or ("BMW" if "BMW" in (pn or "") or not is_shop else "Unbranded"),
        "priceCents": price, "floorPriceCents": floor,
        "supplierCostCents": cost or 0,
        "stockQty": stock_qty, "condition": "NEW" if re.search(r"\bnew\b", name, re.I) else "USED",
        "localPickupOnly": local_pickup, "acceptsOffers": accepts_offers,
        "installEligible": installable, "laborHoursTenths": tenths,
        "weightGrams": WEIGHT.get(cat, 2000),
        "active": listable, "inStock": stock_qty > 0,
        "partNumber": pn, "sourceLabel": source, "statusLabel": status,
        "isKit": False, "kitOf": [], "universalFit": False,
        "fitments": [{"make": m, "model": mo, "yearFrom": y1, "yearTo": y2, "engine": e}
                     for (m, mo, y1, y2, e) in fitments_for(row["Fits / Platform"], source)],
    })

# --- bundles ---------------------------------------------------------------
BUNDLES = [
    ("Bundle-Clip", "PPP-BUNDLE-CLIP", "528i Front Clip — complete front end (12 pieces)", 129000, 103000,
     "body-exterior", "F10 528i (N20)",
     "Complete F10 528i front clip: hood, both fenders, front bumper cover, impact bar, core "
     "support, headlights, grilles, hood latch, inner liners and air ducts. Radiator, condenser "
     "and fan are not included — add the cooling package. One buyer, one pickup.", True, 40),
    ("Bundle-Cooling", "PPP-BUNDLE-COOLING", "528i Cooling Package — radiator, condenser, fan, expansion tank", 29000, 23000,
     "cooling", "F10 528i (N20)",
     "F10 528i cooling package: radiator, A/C condenser, electric cooling fan assembly and "
     "coolant expansion tank. Priced as the front-clip upsell.", True, 30),
    ("Bundle-Lockset", "PPP-BUNDLE-LOCKSET", "528i Lockset — DME + CAS4 + 2 keys (matched set)", 42500, 34000,
     "electrical", "F10 528i (N20)",
     "Matched F10 528i immobilizer set: DME (MEVD17.2.4), CAS4 module and two working keys. "
     "Sold only as a complete set — the pieces are useless apart.", True, 20),
    ("Bundle-WaterPump", "PPP-BUNDLE-WATERPUMP", "N20 Electric Water Pump + Thermostat", 8000, 6000,
     "cooling", "N20 (2012-16)",
     "N20 electric water pump with the thermostat included at no extra charge. Replace both "
     "together — the usual N20 cooling service.", True, 25),
]
for channel_key, sku, name, price, floor, cat, platform, desc, inst, tenths in BUNDLES:
    parts.append({
        "sourceRef": sku, "sku": sku, "slug": slugify(name), "name": name,
        "description": desc + " Local pickup at our shop preferred. Message us for photos.",
        "internalNotes": (
            "Bundle from the Master Inventory summary. Sum-of-parts and discount per that "
            f"sheet. Built from {', '.join(bundle_members.get(channel_key, [])) or 'no linked rows'} — "
            "stock is shared with those rows, so selling either side draws the same pieces down."),
        "categorySlug": cat, "brandName": "BMW",
        "priceCents": price, "floorPriceCents": floor, "supplierCostCents": 0,
        "stockQty": 1, "condition": "USED", "localPickupOnly": True, "acceptsOffers": False,
        "installEligible": inst, "laborHoursTenths": tenths, "weightGrams": 40000,
        "active": True, "inStock": True, "partNumber": None,
        "isKit": True, "kitOf": bundle_members.get(channel_key, []), "universalFit": False,
        "sourceLabel": "F10 528i Part-Out", "statusLabel": "Bundle",
        "fitments": [{"make": m, "model": mo, "yearFrom": y1, "yearTo": y2, "engine": e}
                     for (m, mo, y1, y2, e) in TOKENS[platform]],
    })

# --- shop-stock overrides --------------------------------------------------
# Applied after the mechanical pass so the part-out rows keep their existing
# behaviour untouched. A shop row goes live only if it is a thing a customer
# facing store should actually sell, carries a price, and is either on the
# shelf or a restockable consumable the shop has run out of.
applied = 0
for p in parts:
    ov = OVERRIDES.get(p["sourceRef"])
    if not ov:
        continue
    applied += 1
    p["name"] = ov["name"]
    p["description"] = ov["description"]
    p["categorySlug"] = ov["categorySlug"]
    p["brandName"] = ov["brandName"] or p["brandName"]
    p["condition"] = ov["condition"]
    p["priceCents"] = int(round(float(ov["priceUsd"]) * 100))
    p["floorPriceCents"] = int(round(float(ov["floorUsd"]) * 100)) or None
    p["localPickupOnly"] = bool(ov["localPickupOnly"])
    p["acceptsOffers"] = bool(ov["acceptsOffers"])
    p["installEligible"] = bool(ov["installEligible"])
    p["laborHoursTenths"] = int(ov["laborHoursTenths"])
    p["weightGrams"] = int(ov["weightGrams"])
    p["universalFit"] = bool(ov["universalFit"])
    p["partNumber"] = ov["partNumber"] or p["partNumber"]
    p["slug"] = slugify(f"{ov['name']}-{p['sourceRef']}")
    p["fitments"] = [
        {"make": f["make"], "model": f["model"], "yearFrom": int(f["yearFrom"]),
         "yearTo": int(f["yearTo"]), "engine": (f["engine"] or None)}
        for f in ov["fitments"]
    ]
    # "Out of Stock" is a consumable the shop ran dry, not a part that no
    # longer exists — list it so it is visible and buyable again on restock.
    restockable = p["statusLabel"] == "Out of Stock"
    p["active"] = bool(ov["retailSuitable"]) and p["priceCents"] > 0 and (
        p["stockQty"] > 0 or restockable)
    p["inStock"] = p["stockQty"] > 0

    notes = []
    if ov["retailReason"]:
        notes.append(f"NOT LISTED: {ov['retailReason']}")
    basis = ov["priceBasis"]
    if basis == "SHEET_COST":
        notes.append("Price = the Cost $ column of the shop-system export, per Summary open "
                     "item #12. Retail was blank on every shop-stock line.")
    elif basis == "MARKET_EST":
        notes.append(f"PRICE IS AN ESTIMATE — no cost or ask in the export. {ov['priceRationale']} "
                     "Confirm before relying on it.")
    if ov.get("priceSuspect"):
        notes.append("This number may be wholesale rather than retail — check the margin.")
    if ov["notes"]:
        notes.append(ov["notes"])
    p["internalNotes"] = " ".join([n for n in ([p["internalNotes"]] + notes) if n]) or None

# The override rows are reviewed, not hand-typed, so validate them before they
# reach a live store: a bad category slug means a 404 image, a floor above ask
# means the shop can be talked below its own limit, and a nonsense year range
# means somebody buys a part that will not fit their car.
VALID_CATEGORIES = {
    "brakes", "engine", "suspension", "electrical", "filters", "exhaust", "cooling",
    "lighting", "ignition", "accessories", "body-exterior", "interior", "drivetrain",
    "wheels-tires", "audio-electronics", "fuel-air", "hvac", "shop-supplies",
}
problems = []
for p in parts:
    if p["sourceRef"] not in OVERRIDES:
        continue
    if p["categorySlug"] not in VALID_CATEGORIES:
        problems.append(f"{p['sourceRef']}: unknown category {p['categorySlug']!r}")
    if p["condition"] not in ("NEW", "USED"):
        problems.append(f"{p['sourceRef']}: bad condition {p['condition']!r}")
    if p["priceCents"] < 0:
        problems.append(f"{p['sourceRef']}: negative price")
    if p["floorPriceCents"] and p["floorPriceCents"] > p["priceCents"]:
        problems.append(f"{p['sourceRef']}: floor above ask")
    if not 0 <= p["laborHoursTenths"] <= 400:
        problems.append(f"{p['sourceRef']}: implausible labour {p['laborHoursTenths']}")
    if p["installEligible"] and p["laborHoursTenths"] <= 0:
        problems.append(f"{p['sourceRef']}: installable with no labour time")
    if p["weightGrams"] <= 0:
        problems.append(f"{p['sourceRef']}: non-positive weight")
    for f in p["fitments"]:
        if not (1980 <= f["yearFrom"] <= f["yearTo"] <= 2030):
            problems.append(f"{p['sourceRef']}: bad year range {f['yearFrom']}-{f['yearTo']}")
if problems:
    print("OVERRIDE VALIDATION FAILED:")
    for pr in problems:
        print("   -", pr)
    sys.exit(1)

# --- duplicate physical units ----------------------------------------------
# One object, two rows: listing both would take money for a part that has
# already gone out the door with somebody else's order.
suppressed = 0
for p in parts:
    dup = DUPLICATES.get(p["sourceRef"])
    if not dup:
        continue
    if p["active"]:
        suppressed += 1
    p["active"] = False
    p["internalNotes"] = " ".join(filter(None, [
        p["internalNotes"],
        f"NOT LISTED — same physical unit as {dup['keep']}, which carries the listing. "
        f"{dup.get('reason', '')}".strip(),
    ]))

# Slugs must stay unique after the retitling above.
used = {}
for p in parts:
    base = p["slug"]
    if base in used:
        p["slug"] = f"{base}-{p['sourceRef'].lower()}"
    used[p["slug"]] = True

# Lockset components sell only as the set.
for p in parts:
    if p["sourceRef"] in ("F13", "F130"):
        p["active"] = False
        p["internalNotes"] = ((p["internalNotes"] or "") +
                              " Sold only inside PPP-BUNDLE-LOCKSET.").strip()

# Brand names arrive with inconsistent casing ("FORD" and "Ford" are one
# brand). Merge by slug, preferring the variant that is not all-caps.
canon = {}
for p in parts:
    key = slugify(p["brandName"])
    cur = canon.get(key)
    if cur is None or (cur.isupper() and not p["brandName"].isupper()):
        canon[key] = p["brandName"]
for p in parts:
    p["brandName"] = canon[slugify(p["brandName"])]

json.dump({"generatedFrom": SRC.split("/")[-1], "parts": parts}, open(OUT, "w"), indent=1)

listed = [p for p in parts if p["active"]]
print(f"parts={len(parts)}  listed={len(listed)}  unlisted={len(parts)-len(listed)}")
print(f"shop-stock overrides applied = {applied}")
print(f"duplicate rows suppressed = {suppressed}")
print(f"listed value = ${sum(p['priceCents'] for p in listed)/100:,.2f}")
print(f"shop-stock cost basis = ${sum(p['supplierCostCents']*p['stockQty'] for p in parts if p['sourceLabel']=='Shop Stock')/100:,.2f}")
print("categories:", {c: sum(1 for p in parts if p['categorySlug'] == c) for c in sorted({p['categorySlug'] for p in parts})})
print("no fitment:", sum(1 for p in parts if not p["fitments"]))
if UNMAPPED:
    print("UNMAPPED PLATFORM TOKENS:", sorted(UNMAPPED))
