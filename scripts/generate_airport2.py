import json
import random
import os
import math
from datetime import datetime, timedelta

# flight count set to 1000 for user study. flight count set to 5000 demonstrations.
# user study also ignores airports: IKA, KIX, BLR, CAN, CTU (to balance POINTS_OF_INTEREST, in comparison to other script)

# Step 1: Define airports with lat/lon
airports = [
    # north america
    {"IATA": "YYZ", "Airport Name": "Toronto Pearson International Airport", "City": "Toronto", "Latitude": 43.6777, "Longitude": -79.6248},
    {"IATA": "YVR", "Airport Name": "Vancouver International Airport", "City": "Vancouver", "Latitude": 49.1947, "Longitude": -123.1792},
    {"IATA": "JFK", "Airport Name": "John F. Kennedy International Airport", "City": "New York", "Latitude": 40.6413, "Longitude": -73.7781},
    {"IATA": "LAX", "Airport Name": "Los Angeles International Airport", "City": "Los Angeles", "Latitude": 33.9416, "Longitude": -118.4085},
    {"IATA": "ORD", "Airport Name": "O'Hare International Airport", "City": "Chicago", "Latitude": 40.9762, "Longitude": -87.9073},
    {"IATA": "DFW", "Airport Name": "Dallas/Fort Worth International Airport", "City": "Dallas", "Latitude": 32.8998, "Longitude": -97.0403},
    {"IATA": "BOS", "Airport Name": "Boston Logan International Airport", "City": "Boston", "Latitude": 42.3656, "Longitude": -71.0096},
    {"IATA": "DCA", "Airport Name": "Ronald Reagan Washington National Airport", "City": "Washington", "Latitude": 38.8512, "Longitude": -77.0402},
    
    # europe
    {"IATA": "LHR", "Airport Name": "Heathrow Airport", "City": "London", "Latitude": 51.4700, "Longitude": -0.4543},
    {"IATA": "CDG", "Airport Name": "Charles de Gaulle Airport", "City": "Paris", "Latitude": 49.0097, "Longitude": 2.5479},
    {"IATA": "AMS", "Airport Name": "Schiphol Airport", "City": "Amsterdam", "Latitude": 52.3105, "Longitude": 4.7683},
    {"IATA": "FRA", "Airport Name": "Frankfurt am Main Airport", "City": "Frankfurt", "Latitude": 50.0379, "Longitude": 8.5622},
    {"IATA": "MAD", "Airport Name": "Adolfo Suárez Madrid–Barajas Airport", "City": "Madrid", "Latitude": 40.4722, "Longitude": -3.5608},
    {"IATA": "ZRH", "Airport Name": "Zurich Airport", "City": "Zurich", "Latitude": 47.4581, "Longitude": 8.5550},
    {"IATA": "LIS", "Airport Name": "Humberto Delgado Airport", "City": "Lisbon", "Latitude": 38.7742, "Longitude": -9.1342},
    {"IATA": "VIE", "Airport Name": "Vienna International Airport", "City": "Vienna", "Latitude": 48.1103, "Longitude": 16.5697},
    {"IATA": "PRG", "Airport Name": "Václav Havel Airport Prague", "City": "Prague", "Latitude": 50.1008, "Longitude": 14.2632},
    {"IATA": "WAW", "Airport Name": "Warsaw Chopin Airport", "City": "Warsaw", "Latitude": 52.1657, "Longitude": 20.9671},
    {"IATA": "BUD", "Airport Name": "Budapest Ferenc Liszt International", "City": "Budapest", "Latitude": 47.4298, "Longitude": 19.2610},
    {"IATA": "SVO", "Airport Name": "Sheremetyevo International Airport", "City": "Moscow", "Latitude": 55.9728, "Longitude": 37.4147},
    {"IATA": "FCO", "Airport Name": "Leonardo da Vinci International Airport", "City": "Rome", "Latitude": 42.3601, "Longitude": 12.2429},
    {"IATA": "ARN", "Airport Name": "Stockholm Arlanda Airport", "City": "Stockholm", "Latitude": 59.6519, "Longitude": 17.9186},
    
    # middle east
    {"IATA": "DXB", "Airport Name": "Dubai International Airport", "City": "Dubai", "Latitude": 25.2532, "Longitude": 55.3657},
    {"IATA": "DOH", "Airport Name": "Hamad International Airport", "City": "Doha", "Latitude": 25.2731, "Longitude": 51.6080},
    {"IATA": "TLV", "Airport Name": "Ben Gurion Airport", "City": "Tel Aviv", "Latitude": 32.0004, "Longitude": 34.8706},
    
    # south america
    {"IATA": "GRU", "Airport Name": "São Paulo/Guarulhos International Airport", "City": "São Paulo", "Latitude": -23.4356, "Longitude": -46.4731},
    {"IATA": "EZE", "Airport Name": "Ezeiza International Airport", "City": "Buenos Aires", "Latitude": -34.8222, "Longitude": -58.5358},
    {"IATA": "BOG", "Airport Name": "El Dorado International Airport", "City": "Bogotá", "Latitude": 4.7016, "Longitude": -74.1469},
    {"IATA": "LIM", "Airport Name": "Jorge Chávez International Airport", "City": "Lima", "Latitude": -12.0219, "Longitude": -77.1143},
    {"IATA": "SCL", "Airport Name": "Arturo Merino Benítez International Airport", "City": "Santiago", "Latitude": -33.3928, "Longitude": -70.7856},
    {"IATA": "GIG", "Airport Name": "Rio de Janeiro/Galeão International Airport", "City": "Rio de Janeiro", "Latitude": -22.8099, "Longitude": -43.2506},
    
    # africa
    {"IATA": "CAI", "Airport Name": "Cairo International Airport", "City": "Cairo", "Latitude": 30.1219, "Longitude": 31.4056},
    {"IATA": "JNB", "Airport Name": "O.R. Tambo International Airport", "City": "Johannesburg", "Latitude": -26.1392, "Longitude": 28.2460},
    {"IATA": "CMN", "Airport Name": "Mohammed V International Airport", "City": "Casablanca", "Latitude": 33.3675, "Longitude": -7.5897},
    {"IATA": "NBO", "Airport Name": "Jomo Kenyatta International Airport", "City": "Nairobi", "Latitude": -1.3192, "Longitude": 36.9278},
    
    # asia
    {"IATA": "NRT", "Airport Name": "Narita International Airport", "City": "Tokyo", "Latitude": 35.7647, "Longitude": 140.3864},
    {"IATA": "ICN", "Airport Name": "Incheon International Airport", "City": "Seoul", "Latitude": 37.4602, "Longitude": 126.4407},
    {"IATA": "PEK", "Airport Name": "Beijing Capital International Airport", "City": "Beijing", "Latitude": 39.5098, "Longitude": 116.4105},
    {"IATA": "PVG", "Airport Name": "Shanghai Pudong International Airport", "City": "Shanghai", "Latitude": 31.1443, "Longitude": 121.8083},
    {"IATA": "SIN", "Airport Name": "Singapore Changi Airport", "City": "Singapore", "Latitude": 1.3644, "Longitude": 103.9915},
    {"IATA": "BKK", "Airport Name": "Suvarnabhumi Airport", "City": "Bangkok", "Latitude": 13.6900, "Longitude": 100.7501},
    {"IATA": "DEL", "Airport Name": "Indira Gandhi International Airport", "City": "New Delhi", "Latitude": 28.5562, "Longitude": 77.1000},
    {"IATA": "MNL", "Airport Name": "Ninoy Aquino International Airport", "City": "Manila", "Latitude": 14.5086, "Longitude": 121.0194},
    {"IATA": "HKG", "Airport Name": "Hong Kong International Airport", "City": "Hong Kong", "Latitude": 22.3080, "Longitude": 113.9185},
    {"IATA": "KUL", "Airport Name": "Kuala Lumpur International Airport", "City": "Kuala Lumpur", "Latitude": 2.7456, "Longitude": 101.7072},
    {"IATA": "CGK", "Airport Name": "Soekarno-Hatta International Airport", "City": "Jakarta", "Latitude": -6.1256, "Longitude": 106.6558},
    {"IATA": "BOM", "Airport Name": "Chhatrapati Shivaji Maharaj International Airport", "City": "Mumbai", "Latitude": 19.0896, "Longitude": 72.8656},
    {"IATA": "HAN", "Airport Name": "Noi Bai International Airport", "City": "Hanoi", "Latitude": 21.2187, "Longitude": 105.8047},
    {"IATA": "TPE", "Airport Name": "Taoyuan International Airport", "City": "Taipei", "Latitude": 25.0777, "Longitude": 121.2322},
    {"IATA": "IKA", "Airport Name": "Imam Khomeini International Airport", "City": "Tehran", "Latitude": 35.4161, "Longitude": 51.1522},
    {"IATA": "KIX", "Airport Name": "Kansai International Airport", "City": "Osaka", "Latitude": 34.4320, "Longitude": 135.2304},
    {"IATA": "BLR", "Airport Name": "Kempegowda International Airport", "City": "Bangalore", "Latitude": 13.1986, "Longitude": 77.7066},
    {"IATA": "CAN", "Airport Name": "Guangzhou Baiyun International Airport", "City": "Guangzhou", "Latitude": 23.3924, "Longitude": 113.2988},
    {"IATA": "CTU", "Airport Name": "Chengdu Shuangliu International Airport", "City": "Chengdu", "Latitude": 30.5785, "Longitude": 103.9467},
    
    # australia
    {"IATA": "SYD", "Airport Name": "Sydney Kingsford Smith Airport", "City": "Sydney", "Latitude": -33.9399, "Longitude": 151.1753},
    {"IATA": "PER", "Airport Name": "Perth Airport", "City": "Perth", "Latitude": -31.9403, "Longitude": 115.9669},
    
    # new zealand
    {"IATA": "AKL", "Airport Name": "Auckland Airport", "City": "Auckland", "Latitude": -37.0082, "Longitude": 174.7850}
]

# define airlines with continental dominance
airlines = [
    {"code": "AA", "name": "American Airlines", "continent": "north america"},
    {"code": "LH", "name": "Lufthansa", "continent": "europe"},
    {"code": "LA", "name": "LATAM Airlines", "continent": "south america"},
    {"code": "ET", "name": "Ethiopian Airlines", "continent": "africa"},
    {"code": "SQ", "name": "Singapore Airlines", "continent": "asia"},
    {"code": "QF", "name": "Qantas", "continent": "australia"},
    {"code": "EK", "name": "Emirates", "continent": "middle east"},
    {"code": "AC", "name": "Air Canada", "continent": "north america"},
    {"code": "AF", "name": "Air France", "continent": "europe"},
    {"code": "NZ", "name": "Air New Zealand", "continent": "new zealand"}
]

# PUZZLE SCENARIO DEFINITION
PUZZLE_CONFIG = {
    "friend_a": {
        "origin": "FCO",  # rome
        "name": "User 1",
        "available_dates": ["2025-07-15", "2025-07-16", "2025-07-17", "2025-07-18", "2025-07-19"],
        "preferred_airlines": ["LH", "SQ"],  # lufthansa, singapore airlines
        "max_budget": 700,
        "description": "lives in rome, available july 15-19, prefers lufthansa or singapore airlines, budget max $700"
    },
    "friend_b": {
        "origin": "FCO",  # rome (same as friend_a)
        "name": "User 2",
        "available_dates": ["2025-07-17", "2025-07-18", "2025-07-19", "2025-07-20", "2025-07-21"],
        "preferred_airlines": ["EK", "SQ"],  # emirates, singapore airlines
        "max_budget": 810,
        "description": "lives in rome, available july 17-21, prefers emirates or singapore airlines, budget max $810"
    },
    "destination_region": "asia",
    "common_airline": "SQ",  # singapore airlines - overlapping preference
    "overlap_dates": ["2025-07-17", "2025-07-18", "2025-07-19"],  # when both are available
    "solution_destinations": [
        {"airport": "SIN", "date": "2025-07-17"},  # singapore
        {"airport": "BKK", "date": "2025-07-18"},  # bangkok  
        {"airport": "DEL", "date": "2025-07-19"}   # new delhi
    ]
}

# european airports for the puzzle
EUROPEAN_AIRPORTS = ["LHR", "CDG", "AMS", "FRA", "MAD", "ZRH", "LIS", "VIE", "PRG", "WAW", "BUD", "SVO", "FCO", "ARN"]

# asian airports for the puzzle
ASIAN_AIRPORTS = ["NRT", "ICN", "PEK", "PVG", "SIN", "BKK", "DEL", "MNL", "HKG", "KUL", "CGK", "BOM", "HAN", "TPE", "IKA", "KIX", "BLR", "CAN", "CTU"]

# define points of interest (routes that should have many flights)
POINTS_OF_INTEREST = {
    "FCO": ASIAN_AIRPORTS,  # rome to all asian cities
}

def calculate_distance(lat1, lon1, lat2, lon2):
    """calculate the great-circle distance between two points on earth using the haversine formula."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371  # earth's radius in kilometers
    return c * r

def calculate_flight_time(distance_km):
    """calculate realistic flight time based on distance."""
    base_speed = 800 if distance_km > 2000 else 600
    base_time = distance_km / base_speed
    deviation = random.uniform(-0.15, 0.15)
    flight_time = base_time * (1 + deviation)
    return max(1.0, round(flight_time, 1))

def calculate_flight_price(distance_km, flight_time, is_solution=False):
    """calculate flight price, with special handling for solution flights."""
    # base price calculation with diminishing returns for longer distances
    base_price_per_km = 0.15 * (1 - min(0.5, distance_km / 10000))
    base_price = distance_km * base_price_per_km
    
    # time-based adjustments (longer flights have higher operational costs)
    time_multiplier = 1 + (flight_time / 12)  # reduced impact of flight time
    
    # market variation (random factor)
    variation = random.uniform(-0.15, 0.20)  # slightly asymmetric to favor price increases
    
    # calculate initial price
    final_price = base_price * time_multiplier * (1 + variation)
    
    # distance-based tapering for long-haul flights
    if distance_km > 5000:
        tapering_factor = 1 - min(0.25, (distance_km - 5000) / 20000)
        final_price *= tapering_factor
    
    # special pricing for solution flights to ensure they fit budget constraints
    if is_solution:
        # ensure friend a's flight is under $700 and friend b's is under $810
        # force all solution flights to be within budget but leave some variability
        final_price = random.uniform(550, 680)  # always within both users' budgets
        return round(final_price, 2)
    
    # minimum price floor based on distance (only for non-solution flights)
    min_price = max(150, distance_km * 0.08)
    
    # cap at 2000 but make it rare
    return round(max(min_price, min(2000, final_price)), 2)

def get_airline_for_route(origin, destination, force_airline=None):
    """get airline for a route, with option to force specific airline."""
    if force_airline:
        return next(a for a in airlines if a["code"] == force_airline)
    
    # for puzzle routes, prefer the relevant airlines
    if origin == "FCO" and destination in ASIAN_AIRPORTS:
        return random.choice([a for a in airlines if a["code"] in ["SQ", "LH", "EK"]])
    
    # fallback to random airline
    return random.choice(airlines)

def would_create_unintended_solution(origin, destination, date, price, airline_code, existing_flights):
    """check if this flight would create a solution we do not explicitly intend."""
    # get solution cities from config
    solution_cities = {sol["airport"] for sol in PUZZLE_CONFIG["solution_destinations"]}
    
    # check if this flight could pair with another to create a valid solution
    config = PUZZLE_CONFIG
    
    # only check flights from rome (FCO) to prevent unintended solutions
    if origin != "FCO":
        return False
    
    # check if this could be a valid flight for user 1 AND check existing flights for user 2
    if (date in config["friend_a"]["available_dates"] and
        price <= config["friend_a"]["max_budget"] and
        airline_code in config["friend_a"]["preferred_airlines"]):
        
        # look for any existing user 2 flights to same destination on same date that would work
        for flight in existing_flights:
            if (flight["origin"] == config["friend_b"]["origin"] and
                flight["destination"] == destination and
                flight["date"] == date and
                flight["price"] <= config["friend_b"]["max_budget"] and
                flight["airline"]["code"] in config["friend_b"]["preferred_airlines"] and
                date in config["friend_b"]["available_dates"]):
                return True
    
    # check if this could be a valid flight for user 2 AND check existing flights for user 1
    if (date in config["friend_b"]["available_dates"] and
        price <= config["friend_b"]["max_budget"] and
        airline_code in config["friend_b"]["preferred_airlines"]):
        
        # look for any existing user 1 flights to same destination on same date that would work
        for flight in existing_flights:
            if (flight["origin"] == config["friend_a"]["origin"] and
                flight["destination"] == destination and
                flight["date"] == date and
                flight["price"] <= config["friend_a"]["max_budget"] and
                flight["airline"]["code"] in config["friend_a"]["preferred_airlines"] and
                date in config["friend_a"]["available_dates"]):
                return True
    
    # also check if this flight would make it possible for future flights to create solutions
    # by being too perfect (same price, date, airline for both users)
    overlap_dates = set(config["friend_a"]["available_dates"]) & set(config["friend_b"]["available_dates"])
    common_airlines = set(config["friend_a"]["preferred_airlines"]) & set(config["friend_b"]["preferred_airlines"])
    
    if (date in overlap_dates and
        airline_code in common_airlines and
        price <= config["friend_a"]["max_budget"] and
        price <= config["friend_b"]["max_budget"]):
        return True
    
    return False

def generate_solution_flights():
    """generate solution flights that mirror the structure of generate_airport.py.

    design goal:
    - 3 solution destinations (sin, bkk, del)
    - for each destination/date, exactly 18 ordered solutions overall:
      - effectively 6 ordered solutions per destination
      - this matches the pattern from generate_airport.py (situation a)

    how we achieve 6 ordered solutions per destination:
    - we create a small, controlled set of flights from rome (fco) to each solution city
    - the solver treats any fco→destination flight as usable for either user
    - let:
      - a be the set of flights that are valid for user 1
      - b be the set of flights that are valid for user 2
    - the solver counts all ordered pairs (f1, f2) with f1 in a, f2 in b, and f1.id != f2.id
      so the number of solutions is |a| * |b| - |a ∩ b|
    - to get 6 solutions we enforce, per destination:
      - two flights that are valid for both users (shared flights)
      - two additional flights that are only valid for user 2
      - this gives:
        |a| = 2 (shared flights)
        |b| = 4 (shared flights + two user-2-only flights)
        |a ∩ b| = 2 (the shared flights)
        solutions = |a| * |b| - |a ∩ b| = 2 * 4 - 2 = 6
    """
    flights = []
    flight_id = 1
    
    config = PUZZLE_CONFIG
    airport_dict = {a["IATA"]: a for a in airports}
    
    # generate solution flights for each destination
    for solution in config["solution_destinations"]:
        destination = solution["airport"]
        date = solution["date"]
        
        # base geometry for this route
        origin_a = airport_dict[config["friend_a"]["origin"]]
        dest = airport_dict[destination]
        distance_a = calculate_distance(origin_a["Latitude"], origin_a["Longitude"], 
                                       dest["Latitude"], dest["Longitude"])
        flight_time_a = calculate_flight_time(distance_a)
        origin_b = airport_dict[config["friend_b"]["origin"]]
        distance_b = calculate_distance(origin_b["Latitude"], origin_b["Longitude"], 
                                       dest["Latitude"], dest["Longitude"])
        flight_time_b = calculate_flight_time(distance_b)
        
        # shared flights: valid for both users (sq, under both budgets, on overlap date)
        # these two flights form the intersection a ∩ b
        shared_price_1 = calculate_flight_price(distance_a, flight_time_a, is_solution=True)
        flights.append({
            "id": flight_id,
            "origin": config["friend_a"]["origin"],
            "destination": destination,
            "price": shared_price_1,
            "duration": flight_time_a,
            "date": date,
            "distance_km": round(distance_a, 1),
            "airline": {"code": "SQ", "name": "Singapore Airlines", "continent": "asia"}
        })
        flight_id += 1
        
        shared_price_2 = calculate_flight_price(distance_a, flight_time_a, is_solution=True)
        flights.append({
            "id": flight_id,
            "origin": config["friend_a"]["origin"],
            "destination": destination,
            "price": shared_price_2,
            "duration": flight_time_a,
            "date": date,
            "distance_km": round(distance_a, 1),
            "airline": {"code": "SQ", "name": "Singapore Airlines", "continent": "asia"}
        })
        flight_id += 1
        
        # user-2-only flights: valid for user 2 but invalid for user 1
        # - one sq flight priced just above user 1's budget (so user 1 cannot afford it)
        # - one ek flight (emirates) which user 1 does not prefer
        # both stay within user 2's budget to remain realistic options
        user1_budget = config["friend_a"]["max_budget"]
        user2_budget = config["friend_b"]["max_budget"]
        
        # sq flight that only user 2 can afford
        u2_sq_price = round(random.uniform(user1_budget + 5, min(user2_budget - 5, user1_budget + 100)), 2)
        flights.append({
            "id": flight_id,
            "origin": config["friend_b"]["origin"],
            "destination": destination,
            "price": u2_sq_price,
            "duration": flight_time_b,
            "date": date,
            "distance_km": round(distance_b, 1),
            "airline": {"code": "SQ", "name": "Singapore Airlines", "continent": "asia"}
        })
        flight_id += 1
        
        # ek flight: airline only preferred by user 2
        u2_ek_price = calculate_flight_price(distance_b, flight_time_b, is_solution=True)
        flights.append({
            "id": flight_id,
            "origin": config["friend_b"]["origin"],
            "destination": destination,
            "price": u2_ek_price,
            "duration": flight_time_b,
            "date": date,
            "distance_km": round(distance_b, 1),
            "airline": {"code": "EK", "name": "Emirates", "continent": "middle east"}
        })
        flight_id += 1
        
        # base prices for decoys so they stay in a realistic range
        decoy_base_price_a = shared_price_1
        decoy_base_price_b = u2_ek_price
        
        # generate strategic decoy flights that are cheaper but guaranteed incompatible
        # these will mislead users who sort by price but cannot create valid solutions
        
        # decoy 1: cheap flight for user 1 with wrong airline (no matching user 2 flight)
        decoy_price_1 = decoy_base_price_a * random.uniform(0.6, 0.8)  # 20-40% cheaper
        flights.append({
            "id": flight_id,
            "origin": config["friend_a"]["origin"],
            "destination": destination,
            "price": round(decoy_price_1, 2),
            "duration": flight_time_a,
            "date": date,
            "distance_km": round(distance_a, 1),
            "airline": {"code": "AA", "name": "American Airlines", "continent": "north america"}  # wrong airline for user 1
        })
        flight_id += 1
        
        # decoy 2: cheap flight for user 2 on wrong date (no user 1 available)
        wrong_date = "2025-07-14"  # not in either user's available dates
        decoy_price_2 = decoy_base_price_b * random.uniform(0.5, 0.7)  # 30-50% cheaper
        flights.append({
            "id": flight_id,
            "origin": config["friend_b"]["origin"],
            "destination": destination,
            "price": round(decoy_price_2, 2),
            "duration": flight_time_b,
            "date": wrong_date,
            "distance_km": round(distance_b, 1),
            "airline": {"code": "SQ", "name": "Singapore Airlines", "continent": "asia"}
        })
        flight_id += 1
        
        # decoy 3: orphaned cheap flight for user 1 only (no user 2 available this date)
        orphan_date = "2025-07-15"  # only user 1 is available
        orphan_price = decoy_base_price_a * random.uniform(0.4, 0.6)  # very cheap
        flights.append({
            "id": flight_id,
            "origin": config["friend_a"]["origin"],
            "destination": destination,
            "price": round(orphan_price, 2),
            "duration": flight_time_a,
            "date": orphan_date,
            "distance_km": round(distance_a, 1),
            "airline": {"code": "LH", "name": "Lufthansa", "continent": "europe"}
        })
        flight_id += 1
        
        # decoy 4: orphaned cheap flight for user 2 only (no user 1 available this date)
        orphan_date_2 = "2025-07-21"  # only user 2 is available
        orphan_price_2 = decoy_base_price_b * random.uniform(0.3, 0.55)  # extremely cheap
        flights.append({
            "id": flight_id,
            "origin": config["friend_b"]["origin"],
            "destination": destination,
            "price": round(orphan_price_2, 2),
            "duration": flight_time_b,
            "date": orphan_date_2,
            "distance_km": round(distance_b, 1),
            "airline": {"code": "EK", "name": "Emirates", "continent": "middle east"}
        })
        flight_id += 1
        
        # decoy 5: cheap but over user 1's budget (appears valid but unaffordable)
        over_budget_price = config["friend_a"]["max_budget"] + random.uniform(50, 150)
        flights.append({
            "id": flight_id,
            "origin": config["friend_a"]["origin"],
            "destination": destination,
            "price": round(over_budget_price, 2),
            "duration": flight_time_a,
            "date": date,
            "distance_km": round(distance_a, 1),
            "airline": {"code": "LH", "name": "Lufthansa", "continent": "europe"}
        })
        flight_id += 1
        
        # decoy 6: high-price sq flight (over both users' budgets so it can never be valid)
        near_budget_price = config["friend_b"]["max_budget"] + random.uniform(5, 25)
        flights.append({
            "id": flight_id,
            "origin": config["friend_a"]["origin"],
            "destination": destination,
            "price": round(near_budget_price, 2),
            "duration": flight_time_a,
            "date": date,
            "distance_km": round(distance_a, 1),
            "airline": {"code": "SQ", "name": "Singapore Airlines", "continent": "asia"}
        })
        flight_id += 1
    
    return flights, flight_id

def generate_interest_flights(start_flight_id):
    """generate many flights for points of interest (origin cities to asian destinations)."""
    flights = []
    flight_id = start_flight_id
    airport_dict = {a["IATA"]: a for a in airports}
    
    # generate dates from july 8 to july 21
    all_dates = []
    for i in range(14):  # july 1 to july 21
        date = datetime(2025, 7, 8) + timedelta(days=i)
        all_dates.append(date.strftime("%Y-%m-%d"))
    
    # generate many flights for each interest route
    for origin in POINTS_OF_INTEREST:
        for destination in POINTS_OF_INTEREST[origin]:
            # generate 30-35 flights per route to increase solution chances
            num_flights = random.randint(20, 25)
            
            # track which dates we've used for solution routes to avoid duplicates
            solution_dates_used = set()
            
            # check if this route matches any solution routes
            for solution in PUZZLE_CONFIG["solution_destinations"]:
                if ((origin == PUZZLE_CONFIG["friend_a"]["origin"] and 
                     destination == solution["airport"]) or 
                    (origin == PUZZLE_CONFIG["friend_b"]["origin"] and 
                     destination == solution["airport"])):
                    solution_dates_used.add(solution["date"])
            
            for _ in range(num_flights):
                origin_airport = airport_dict[origin]
                dest_airport = airport_dict[destination]
                distance = calculate_distance(origin_airport["Latitude"], origin_airport["Longitude"],
                                            dest_airport["Latitude"], dest_airport["Longitude"])
                flight_time = calculate_flight_time(distance)
                
                # generate flight with rerolling to avoid unintended solutions
                max_attempts = 50
                for attempt in range(max_attempts):
                    price = calculate_flight_price(distance, flight_time)
                    date = random.choice(all_dates)
                    airline = get_airline_for_route(origin, destination)
                    
                    # avoid duplicating any solution flights
                    if date in solution_dates_used:
                        continue
                    
                    # always check for unintended solutions so interest flights
                    # do not accidentally create additional valid puzzle answers
                    if would_create_unintended_solution(origin, destination, date, price, airline["code"], flights):
                        continue
                    
                    # if we get here, the flight is acceptable
                    break
                else:
                    # if we can't find a good flight after max attempts, use fallback values
                    price = calculate_flight_price(distance, flight_time) * 2  # make it expensive
                    date = random.choice(all_dates)
                    airline = random.choice([a for a in airlines if a["code"] not in ["SQ", "LH", "EK"]])
                
                flights.append({
                    "id": flight_id,
                    "origin": origin,
                    "destination": destination,
                    "price": price,
                    "duration": flight_time,
                    "date": date,
                    "distance_km": round(distance, 1),
                    "airline": airline
                })
                flight_id += 1
    
    return flights, flight_id

def generate_filler_flights(start_flight_id, target_total=5000):
    """generate filler flights for other routes with limited quantities."""
    flights = []
    flight_id = start_flight_id
    airport_dict = {a["IATA"]: a for a in airports}
    iata_codes = [a["IATA"] for a in airports]
    
    # generate dates from july 1 to july 21
    all_dates = []
    for i in range(21):  # july 1 to july 21
        date = datetime(2025, 7, 1) + timedelta(days=i)
        all_dates.append(date.strftime("%Y-%m-%d"))
    
    # track routes we've already covered
    covered_routes = set()
    for origin in POINTS_OF_INTEREST:
        for destination in POINTS_OF_INTEREST[origin]:
            covered_routes.add((origin, destination))
    
    # add solution routes
    for solution in PUZZLE_CONFIG["solution_destinations"]:
        covered_routes.add((PUZZLE_CONFIG["friend_a"]["origin"], solution["airport"]))
        covered_routes.add((PUZZLE_CONFIG["friend_b"]["origin"], solution["airport"]))
    
    while len(flights) < (target_total - start_flight_id + 1):
        origin, destination = random.sample(iata_codes, 2)
        route = (origin, destination)
        
        # skip if already covered or if we've generated enough for this route
        existing_count = sum(1 for f in flights if f["origin"] == origin and f["destination"] == destination)
        if route in covered_routes or existing_count >= 5:
            continue
        
        origin_airport = airport_dict[origin]
        dest_airport = airport_dict[destination]
        distance = calculate_distance(origin_airport["Latitude"], origin_airport["Longitude"],
                                    dest_airport["Latitude"], dest_airport["Longitude"])
        flight_time = calculate_flight_time(distance)
        
        # generate flight with rerolling to avoid unintended solutions
        max_attempts = 30
        for attempt in range(max_attempts):
            price = calculate_flight_price(distance, flight_time)
            date = random.choice(all_dates)
            airline = get_airline_for_route(origin, destination)
            
            # check if this would create an unintended solution for the puzzle users
            if would_create_unintended_solution(origin, destination, date, price, airline["code"], flights):
                continue
            
            # if we get here, the flight is acceptable
            break
        else:
            # if we can't find a good flight after max attempts, use fallback values
            price = calculate_flight_price(distance, flight_time) * 2  # make it expensive
            date = random.choice(all_dates)
            airline = random.choice([a for a in airlines if a["code"] not in ["SQ", "LH", "EK"]])
        
        flights.append({
            "id": flight_id,
            "origin": origin,
            "destination": destination,
            "price": price,
            "duration": flight_time,
            "date": date,
            "distance_km": round(distance, 1),
            "airline": airline
        })
        flight_id += 1
    
    return flights

# generate all flights
print("🔍 generating puzzle flights...")
solution_flights, next_id = generate_solution_flights()
print(f"✅ generated {len(solution_flights)} solution flights")

interest_flights, next_id = generate_interest_flights(next_id)
print(f"✅ generated {len(interest_flights)} interest flights")

filler_flights = generate_filler_flights(next_id, 5000)
print(f"✅ generated {len(filler_flights)} filler flights")

all_flights = solution_flights + interest_flights + filler_flights
print(f"📊 total flights generated: {len(all_flights)}")

# create puzzle description
puzzle_description = {
    "title": "Travel Rendezvous Challenge",
    "description": "Two users want to meet for a vacation. Help them find flights that work for both!",
    "friends": {
        "user_1": {
            "name": "User 1",
            "description": "lives in rome, available july 15-19, prefers lufthansa or singapore airlines, budget max $700",
            "origin_airport": "FCO",
            "available_dates": ["2025-07-15", "2025-07-16", "2025-07-17", "2025-07-18", "2025-07-19"],
            "preferred_airlines": ["LH", "SQ"],
            "max_budget": 700
        },
        "user_2": {
            "name": "User 2", 
            "description": "lives in rome, available july 17-21, prefers emirates or singapore airlines, budget max $810",
            "origin_airport": "FCO",
            "available_dates": ["2025-07-17", "2025-07-18", "2025-07-19", "2025-07-20", "2025-07-21"],
            "preferred_airlines": ["EK", "SQ"],
            "max_budget": 810
        }
    },
    "constraints": {
        "must_arrive_same_day": True,
        "both_must_afford": True,
        "both_must_be_available": True,
        "overlap_dates": ["2025-07-17", "2025-07-18", "2025-07-19"]
    },
    "evaluation_criteria": {
        "valid_solution": {
            "same_destination": "flights must go to the same destination airport",
            "same_date": "flights must be on the same date", 
            "within_budgets": "user_1's flight <= $700, user_2's flight <= $810",
            "date_availability": "date must be in both users' available dates",
            "airline_preferences": "each user must use one of their preferred airlines"
        }
    },
    "hints": {
        "overlap_dates": "look for dates when both users are available (july 17-19)",
        "budget_consideration": "both users need to stay within their budgets",
        "airline_preferences": "each user must use one of their preferred airlines",
        "multiple_solutions": "there may be several valid combinations - any that meet all criteria work!"
    }
}

# save to json files
os.makedirs("assets", exist_ok=True)

try:
    with open("assets/airports.json", "w") as f:
        json.dump(airports, f, indent=2)

    with open("assets/airlines.json", "w") as f:
        json.dump(airlines, f, indent=2)

    with open("assets/flights.json", "w") as f:
        json.dump(all_flights, f, indent=2)
    
    with open("assets/puzzle_description.json", "w") as f:
        json.dump(puzzle_description, f, indent=2)

    print("✅ all files created successfully!")
    print("\n🎯 PUZZLE SCENARIO:")
    print("=" * 50)
    print(f"🏠 User 1 {puzzle_description['friends']['user_1']['description']}")
    print(f"🏠 User 2 {puzzle_description['friends']['user_2']['description']}")
    print(f"🎯 Goal: Meet for a vacation")
    print(f"✈️  Must arrive same day, each using preferred airlines")
    print(f"💡 Hint: User 1 prefers {puzzle_description['friends']['user_1']['preferred_airlines']}, User 2 prefers {puzzle_description['friends']['user_2']['preferred_airlines']}")
    print(f"🎲 Multiple solutions exist - any valid combination works!")
    print("=" * 50)
    
except Exception as e:
    print(f"❌ error writing files: {e}")
    print(f"current working directory: {os.getcwd()}")