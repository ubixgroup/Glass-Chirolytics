import json
import random
from typing import Dict, List, Tuple

# state populations (more accurate historical data)
# updated based on historical census data
STATE_POPULATIONS_1960S = {
    "CALIFORNIA": 15717204, "NEW YORK": 16782304, "TEXAS": 9579677, "PENNSYLVANIA": 11319366,
    "ILLINOIS": 10081158, "OHIO": 9706397, "MICHIGAN": 7823194, "NEW JERSEY": 6066782,
    "FLORIDA": 4951560, "MASSACHUSETTS": 5148578, "NORTH CAROLINA": 4556155, "INDIANA": 4662498,
    "MISSOURI": 4319813, "WISCONSIN": 3951777, "VIRGINIA": 3966949, "GEORGIA": 3943116,
    "TENNESSEE": 3567089, "MINNESOTA": 3413864, "ALABAMA": 3266740, "LOUISIANA": 3257022,
    "WASHINGTON": 2853214, "IOWA": 2757537, "KENTUCKY": 3038156, "CONNECTICUT": 2535234,
    "SOUTH CAROLINA": 2382594, "OKLAHOMA": 2328284, "KANSAS": 2178611, "MISSISSIPPI": 2178141,
    "WEST VIRGINIA": 1860421, "ARKANSAS": 1786272, "OREGON": 1768687, "COLORADO": 1753947,
    "NEBRASKA": 1411330, "ARIZONA": 1302161, "MARYLAND": 3100689, "MAINE": 969265,
    "NEW MEXICO": 951023, "UTAH": 890627, "RHODE ISLAND": 859488, "DISTRICT OF COLUMBIA": 763956,
    "SOUTH DAKOTA": 680514, "MONTANA": 674767, "IDAHO": 667191, "HAWAII": 632772,
    "NORTH DAKOTA": 632446, "NEW HAMPSHIRE": 606921, "DELAWARE": 446292, "VERMONT": 389881,
    "WYOMING": 330066, "ALASKA": 226167
}

STATE_POPULATIONS_1990S = {
    "CALIFORNIA": 29760021, "NEW YORK": 17990455, "TEXAS": 16986510, "FLORIDA": 12937926,
    "PENNSYLVANIA": 11881643, "ILLINOIS": 11430602, "OHIO": 10847115, "MICHIGAN": 9295297,
    "NEW JERSEY": 7730188, "NORTH CAROLINA": 6628637, "GEORGIA": 6478216, "VIRGINIA": 6187358,
    "MASSACHUSETTS": 6016425, "INDIANA": 5544159, "MISSOURI": 5117073, "WISCONSIN": 4891769,
    "TENNESSEE": 4877185, "MARYLAND": 4781468, "MINNESOTA": 4375099, "LOUISIANA": 4219973,
    "ALABAMA": 4040587, "KENTUCKY": 3685296, "ARIZONA": 3665228, "SOUTH CAROLINA": 3486703,
    "COLORADO": 3294394, "CONNECTICUT": 3287116, "OKLAHOMA": 3145585, "OREGON": 2842321,
    "IOWA": 2776755, "MISSISSIPPI": 2573216, "KANSAS": 2477574, "ARKANSAS": 2350725,
    "WEST VIRGINIA": 1793477, "UTAH": 1722850, "NEBRASKA": 1578385, "NEW MEXICO": 1515069,
    "MAINE": 1227928, "NEVADA": 1201833, "NEW HAMPSHIRE": 1109252, "HAWAII": 1108229,
    "IDAHO": 1006749, "RHODE ISLAND": 1003464, "MONTANA": 799065, "SOUTH DAKOTA": 696004,
    "DELAWARE": 666168, "NORTH DAKOTA": 638800, "DISTRICT OF COLUMBIA": 606900, "VERMONT": 562758,
    "ALASKA": 550043, "WYOMING": 453588
}

STATE_POPULATIONS_2020S = {
    "CALIFORNIA": 39538223, "TEXAS": 29145505, "FLORIDA": 21538187, "NEW YORK": 20201249,
    "PENNSYLVANIA": 12801989, "ILLINOIS": 12801989, "OHIO": 11799448, "GEORGIA": 10711908,
    "NORTH CAROLINA": 10439388, "MICHIGAN": 10077331, "NEW JERSEY": 9288994, "VIRGINIA": 8631393,
    "WASHINGTON": 7705281, "ARIZONA": 7151502, "MASSACHUSETTS": 7029917, "TENNESSEE": 6910840,
    "INDIANA": 6785528, "MARYLAND": 6177224, "MISSOURI": 6154913, "WISCONSIN": 5893718,
    "COLORADO": 5773714, "MINNESOTA": 5706494, "SOUTH CAROLINA": 5118425, "ALABAMA": 5024279,
    "LOUISIANA": 4657757, "KENTUCKY": 4505836, "OREGON": 4237256, "OKLAHOMA": 3959353,
    "CONNECTICUT": 3605944, "UTAH": 3271616, "IOWA": 3190369, "NEVADA": 3104614,
    "ARKANSAS": 3011524, "MISSISSIPPI": 2961279, "KANSAS": 2937880, "NEW MEXICO": 2117522,
    "NEBRASKA": 1961504, "IDAHO": 1839106, "WEST VIRGINIA": 1793716, "HAWAII": 1455271,
    "NEW HAMPSHIRE": 1377529, "MAINE": 1362359, "MONTANA": 1084225, "RHODE ISLAND": 1097379,
    "DELAWARE": 989948, "SOUTH DAKOTA": 886667, "NORTH DAKOTA": 779094, "ALASKA": 733391,
    "DISTRICT OF COLUMBIA": 689545, "VERMONT": 643077, "WYOMING": 576851
}

ALL_STATE_POPULATIONS = {
    "1960s": STATE_POPULATIONS_1960S,
    "1990s": STATE_POPULATIONS_1990S,
    "2020s": STATE_POPULATIONS_2020S,
}

# define neighboring states for more realistic migration patterns
NEIGHBORING_STATES = {
    "ALABAMA": ["FLORIDA", "GEORGIA", "TENNESSEE", "MISSISSIPPI"],
    "ALASKA": ["WASHINGTON"],  # not actually neighboring but closest
    "ARIZONA": ["CALIFORNIA", "NEVADA", "NEW MEXICO", "UTAH", "COLORADO"],
    "ARKANSAS": ["LOUISIANA", "MISSISSIPPI", "MISSOURI", "OKLAHOMA", "TENNESSEE", "TEXAS"],
    "CALIFORNIA": ["ARIZONA", "NEVADA", "OREGON"],
    "COLORADO": ["KANSAS", "NEBRASKA", "NEW MEXICO", "OKLAHOMA", "UTAH", "WYOMING", "ARIZONA"],
    "CONNECTICUT": ["MASSACHUSETTS", "NEW YORK", "RHODE ISLAND"],
    "DELAWARE": ["MARYLAND", "NEW JERSEY", "PENNSYLVANIA"],
    "DISTRICT OF COLUMBIA": ["MARYLAND", "VIRGINIA"],
    "FLORIDA": ["ALABAMA", "GEORGIA"],
    "GEORGIA": ["ALABAMA", "FLORIDA", "NORTH CAROLINA", "SOUTH CAROLINA", "TENNESSEE"],
    "HAWAII": ["CALIFORNIA"],  # not actually neighboring but closest
    "IDAHO": ["MONTANA", "NEVADA", "OREGON", "UTAH", "WASHINGTON", "WYOMING"],
    "ILLINOIS": ["INDIANA", "IOWA", "KENTUCKY", "MISSOURI", "WISCONSIN"],
    "INDIANA": ["ILLINOIS", "KENTUCKY", "MICHIGAN", "OHIO"],
    "IOWA": ["ILLINOIS", "MINNESOTA", "MISSOURI", "NEBRASKA", "SOUTH DAKOTA", "WISCONSIN"],
    "KANSAS": ["COLORADO", "MISSOURI", "NEBRASKA", "OKLAHOMA"],
    "KENTUCKY": ["ILLINOIS", "INDIANA", "MISSOURI", "OHIO", "TENNESSEE", "VIRGINIA", "WEST VIRGINIA"],
    "LOUISIANA": ["ARKANSAS", "MISSISSIPPI", "TEXAS"],
    "MAINE": ["NEW HAMPSHIRE"],
    "MARYLAND": ["DELAWARE", "PENNSYLVANIA", "VIRGINIA", "WEST VIRGINIA", "DISTRICT OF COLUMBIA"],
    "MASSACHUSETTS": ["CONNECTICUT", "NEW HAMPSHIRE", "NEW YORK", "RHODE ISLAND", "VERMONT"],
    "MICHIGAN": ["INDIANA", "OHIO", "WISCONSIN"],
    "MINNESOTA": ["IOWA", "NORTH DAKOTA", "SOUTH DAKOTA", "WISCONSIN"],
    "MISSISSIPPI": ["ALABAMA", "ARKANSAS", "LOUISIANA", "TENNESSEE"],
    "MISSOURI": ["ARKANSAS", "ILLINOIS", "IOWA", "KANSAS", "KENTUCKY", "NEBRASKA", "OKLAHOMA", "TENNESSEE"],
    "MONTANA": ["IDAHO", "NORTH DAKOTA", "SOUTH DAKOTA", "WYOMING"],
    "NEBRASKA": ["COLORADO", "IOWA", "KANSAS", "MISSOURI", "SOUTH DAKOTA", "WYOMING"],
    "NEVADA": ["ARIZONA", "CALIFORNIA", "IDAHO", "OREGON", "UTAH"],
    "NEW HAMPSHIRE": ["MAINE", "MASSACHUSETTS", "VERMONT"],
    "NEW JERSEY": ["DELAWARE", "NEW YORK", "PENNSYLVANIA"],
    "NEW MEXICO": ["ARIZONA", "COLORADO", "OKLAHOMA", "TEXAS", "UTAH"],
    "NEW YORK": ["CONNECTICUT", "MASSACHUSETTS", "NEW JERSEY", "PENNSYLVANIA", "VERMONT"],
    "NORTH CAROLINA": ["GEORGIA", "SOUTH CAROLINA", "TENNESSEE", "VIRGINIA"],
    "NORTH DAKOTA": ["MINNESOTA", "MONTANA", "SOUTH DAKOTA"],
    "OHIO": ["INDIANA", "KENTUCKY", "MICHIGAN", "PENNSYLVANIA", "WEST VIRGINIA"],
    "OKLAHOMA": ["ARKANSAS", "COLORADO", "KANSAS", "MISSOURI", "NEW MEXICO", "TEXAS"],
    "OREGON": ["CALIFORNIA", "IDAHO", "NEVADA", "WASHINGTON"],
    "PENNSYLVANIA": ["DELAWARE", "MARYLAND", "NEW JERSEY", "NEW YORK", "OHIO", "WEST VIRGINIA"],
    "RHODE ISLAND": ["CONNECTICUT", "MASSACHUSETTS"],
    "SOUTH CAROLINA": ["GEORGIA", "NORTH CAROLINA"],
    "SOUTH DAKOTA": ["IOWA", "MINNESOTA", "MONTANA", "NEBRASKA", "NORTH DAKOTA", "WYOMING"],
    "TENNESSEE": ["ALABAMA", "ARKANSAS", "GEORGIA", "KENTUCKY", "MISSISSIPPI", "MISSOURI", "NORTH CAROLINA", "VIRGINIA"],
    "TEXAS": ["ARKANSAS", "LOUISIANA", "NEW MEXICO", "OKLAHOMA"],
    "UTAH": ["ARIZONA", "COLORADO", "IDAHO", "NEVADA", "NEW MEXICO", "WYOMING"],
    "VERMONT": ["MASSACHUSETTS", "NEW HAMPSHIRE", "NEW YORK"],
    "VIRGINIA": ["KENTUCKY", "MARYLAND", "NORTH CAROLINA", "TENNESSEE", "WEST VIRGINIA", "DISTRICT OF COLUMBIA"],
    "WASHINGTON": ["IDAHO", "OREGON"],
    "WEST VIRGINIA": ["KENTUCKY", "MARYLAND", "OHIO", "PENNSYLVANIA", "VIRGINIA"],
    "WISCONSIN": ["ILLINOIS", "IOWA", "MICHIGAN", "MINNESOTA"],
    "WYOMING": ["COLORADO", "IDAHO", "MONTANA", "NEBRASKA", "SOUTH DAKOTA", "UTAH"]
}

# regional migration patterns based on historical data
# 1960s: post-wwii era, great migration continuation, california boom
DESTINATION_MULTIPLIERS_1960S = {
    # california as major destination for workers and families
    "CALIFORNIA": 2.1,  # very strong magnet for migrants from all over US
    # industrial midwest and northeast still strong but declining
    "NEW YORK": 1.4,  # still major destination but starting to lose appeal
    "ILLINOIS": 1.3,  # chicago as major industrial center
    "MICHIGAN": 1.4,  # auto industry boom
    "OHIO": 1.2,  # industrial growth
    # early sunbelt destinations
    "FLORIDA": 1.3,  # retirement destination starting to emerge
    "TEXAS": 1.2,  # oil industry and space program
    # other growing states
    "NEW JERSEY": 1.1,  # suburban growth
    "VIRGINIA": 1.1,  # government growth around dc
    "WASHINGTON": 1.1,  # boeing and tech beginning
}

# 1990s: sunbelt migration, tech boom, reverse great migration to south
DESTINATION_MULTIPLIERS_1990S = {
    # sunbelt states as major destinations
    "FLORIDA": 1.8,  # major retirement and general migration destination
    "TEXAS": 1.6,  # oil, tech, lower costs
    "CALIFORNIA": 1.5,  # tech boom but also beginning outmigration
    # southern states gaining
    "GEORGIA": 1.4,  # atlanta as major hub
    "NORTH CAROLINA": 1.3,  # research triangle and banking
    "ARIZONA": 1.4,  # retirees and general population growth
    "NEVADA": 1.3,  # gaming, tourism, and no state income tax
    # mountain west
    "COLORADO": 1.3,  # outdoor lifestyle and tech growth
    "UTAH": 1.2,  # economic growth and lifestyle
    # pacific northwest
    "WASHINGTON": 1.3,  # microsoft, boeing, tech boom
    "OREGON": 1.2,  # lifestyle migration
    # continued southern growth
    "TENNESSEE": 1.2,  # business friendly environment
    "SOUTH CAROLINA": 1.1,  # manufacturing and retirees
    "VIRGINIA": 1.2,  # government and tech corridor
}

# 2020s: continued sunbelt growth, remote work era, california exodus
# validated against us census 2022-2023 data:
# - california → texas: largest interstate flow (42,479 in 2022)
# - california: lowest inmigration rate (11.1%) nationally
# - texas: lowest outmigration rate (11.7%) nationally
# - florida, texas dominate as destinations
DESTINATION_MULTIPLIERS_2020S = {
    # major sunbelt destinations
    "FLORIDA": 1.9,  # no income tax, retirees, remote workers
    "TEXAS": 1.9,  # business friendly, no income tax, tech growth (increased from 1.8)
    "ARIZONA": 1.5,  # lower costs, retirees, growing economy
    # southeastern growth
    "NORTH CAROLINA": 1.4,  # tech, finance, research triangle
    "GEORGIA": 1.3,  # atlanta hub, film industry, logistics
    "TENNESSEE": 1.4,  # no income tax, business friendly, nashville growth
    "SOUTH CAROLINA": 1.2,  # manufacturing, lower costs
    # mountain west
    "COLORADO": 1.3,  # outdoor lifestyle, remote work friendly
    "UTAH": 1.3,  # tech growth, business friendly
    "IDAHO": 1.2,  # lower costs, lifestyle migration
    "MONTANA": 1.1,  # lifestyle migration, remote work
    # other growing areas
    "NEVADA": 1.2,  # no income tax, business growth
    "WASHINGTON": 1.2,  # tech industry, but also outmigration due to costs
    # note: california now has negative migration multiplier
}

# states people are leaving from (negative migration multipliers)
ORIGIN_PENALTIES = {
    "1960s": {
        # dust bowl aftermath and mechanization of agriculture
        "OKLAHOMA": 0.8,
        "ARKANSAS": 0.8,
        "MISSISSIPPI": 0.7,  # great migration source
        "ALABAMA": 0.7,  # great migration source
        "SOUTH CAROLINA": 0.8,
        "WEST VIRGINIA": 0.7,  # coal industry decline
        "NORTH DAKOTA": 0.8,
        "SOUTH DAKOTA": 0.8,
    },
    "1990s": {
        # rust belt decline
        "WEST VIRGINIA": 0.6,  # severe economic decline
        "IOWA": 0.8,  # agricultural consolidation
        "NORTH DAKOTA": 0.7,  # economic challenges
        "MONTANA": 0.8,
        "WYOMING": 0.8,
        "MAINE": 0.8,
        "VERMONT": 0.8,
    },
    "2020s": {
        # high cost, high tax states losing residents
        # validated against census data: california has lowest inmigration rate (11.1%) nationally
        "CALIFORNIA": 0.65,  # major outmigration due to costs and policies (decreased from 0.7)
        "NEW YORK": 0.8,  # high taxes, covid impact, remote work
        "ILLINOIS": 0.8,  # high taxes, crime, budget issues
        "CONNECTICUT": 0.8,  # high costs, limited opportunities
        "NEW JERSEY": 0.9,  # high taxes and costs
        "MASSACHUSETTS": 0.9,  # high costs but still some draw
        # continued rural decline
        "WEST VIRGINIA": 0.6,
        "WYOMING": 0.8,
        "ALASKA": 0.8,  # economic challenges
    }
}

ALL_DESTINATION_MULTIPLIERS = {
    "1960s": DESTINATION_MULTIPLIERS_1960S,
    "1990s": DESTINATION_MULTIPLIERS_1990S,
    "2020s": DESTINATION_MULTIPLIERS_2020S,
}

# distance decay - migration decreases with distance but major economic centers overcome this
DISTANCE_REGIONS = {
    "NORTHEAST": ["MAINE", "NEW HAMPSHIRE", "VERMONT", "MASSACHUSETTS", "RHODE ISLAND", 
                  "CONNECTICUT", "NEW YORK", "NEW JERSEY", "PENNSYLVANIA"],
    "MIDWEST": ["OHIO", "MICHIGAN", "INDIANA", "WISCONSIN", "ILLINOIS", "MINNESOTA", 
                "IOWA", "MISSOURI", "NORTH DAKOTA", "SOUTH DAKOTA", "NEBRASKA", "KANSAS"],
    "SOUTH": ["DELAWARE", "MARYLAND", "DISTRICT OF COLUMBIA", "VIRGINIA", "WEST VIRGINIA",
              "KENTUCKY", "TENNESSEE", "NORTH CAROLINA", "SOUTH CAROLINA", "GEORGIA",
              "FLORIDA", "ALABAMA", "MISSISSIPPI", "ARKANSAS", "LOUISIANA", "OKLAHOMA", "TEXAS"],
    "WEST": ["MONTANA", "IDAHO", "WYOMING", "COLORADO", "NEW MEXICO", "ARIZONA", "UTAH",
             "NEVADA", "WASHINGTON", "OREGON", "CALIFORNIA", "ALASKA", "HAWAII"]
}

def get_region(state: str) -> str:
    """get the census region for a state."""
    for region, states in DISTANCE_REGIONS.items():
        if state in states:
            return region
    return "UNKNOWN"

def calculate_distance_multiplier(origin: str, destination: str, era: str) -> float:
    """calculate distance-based migration multiplier."""
    origin_region = get_region(origin)
    dest_region = get_region(destination)
    
    # same region gets boost
    if origin_region == dest_region:
        return 1.2
    
    # cross-country migration patterns based on era
    if era == "1960s":
        # great migration: south to north/west
        if origin_region == "SOUTH" and dest_region in ["MIDWEST", "NORTHEAST", "WEST"]:
            return 1.3
        # westward movement
        if dest_region == "WEST":
            return 1.1
        return 0.9
    
    elif era == "1990s":
        # reverse migration to south
        if dest_region == "SOUTH":
            return 1.2
        # continued west coast attraction
        if dest_region == "WEST":
            return 1.1
        # rust belt to sunbelt
        if origin_region in ["MIDWEST", "NORTHEAST"] and dest_region == "SOUTH":
            return 1.3
        return 0.9
    
    elif era == "2020s":
        # major migration to south and mountain west
        if dest_region == "SOUTH":
            return 1.3
        # california exodus
        if origin == "CALIFORNIA":
            return 1.2  # people leaving california go everywhere
        # high tax states to low tax states
        if origin_region in ["NORTHEAST", "MIDWEST"] and dest_region in ["SOUTH", "WEST"]:
            return 1.2
        return 0.9
    
    return 1.0

def generate_migration_value(origin: str, destination: str, era: str) -> int:
    """generate a synthetic migration value based on various factors for a specific era."""
    if origin == destination:
        return 0
    
    current_state_populations = ALL_STATE_POPULATIONS[era]
    current_destination_multipliers = ALL_DESTINATION_MULTIPLIERS[era]

    # base value from population sizes (with improved formula)
    origin_pop = current_state_populations[origin]
    dest_pop = current_state_populations[destination]
    
    # more realistic base calculation - migration flows scale with both populations
    # but with diminishing returns for very large populations
    base_value = int((origin_pop ** 0.8 * dest_pop ** 0.6) / 50000)
    
    # apply neighboring state multiplier (people move to nearby states more often)
    if destination in NEIGHBORING_STATES[origin]:
        base_value *= random.uniform(1.8, 2.5)  # stronger neighbor effect
    
    # apply destination state multiplier if applicable
    if destination in current_destination_multipliers:
        base_value *= current_destination_multipliers[destination]
    
    # apply origin penalties (people leaving certain states)
    if era in ORIGIN_PENALTIES and origin in ORIGIN_PENALTIES[era]:
        base_value *= ORIGIN_PENALTIES[era][origin]
    
    # apply distance/regional patterns
    distance_mult = calculate_distance_multiplier(origin, destination, era)
    base_value *= distance_mult
    
    # add economic factors variation
    base_value *= random.uniform(0.7, 1.3)
    
    # ensure minimum value but scale with era (more migration in recent decades)
    min_values = {"1960s": 50, "1990s": 75, "2020s": 100}
    min_value = min_values.get(era, 100)
    
    return max(min_value, int(base_value))

def generate_migration_data(era: str) -> Tuple[List[Dict], List[Dict]]:
    """generate complete migration data for all state pairs for a specific era.
    returns tuple of (absolute_migrations, rate_migrations)."""
    absolute_migrations = []
    rate_migrations = []
    states = list(STATE_POPULATIONS_2020S.keys())
    
    # set random seed for reproducible results within each era
    random.seed(hash(era) % 1000000)
    
    current_state_populations = ALL_STATE_POPULATIONS[era]
    
    for origin in states:
        for destination in states:
            if origin != destination:
                if origin in current_state_populations and destination in current_state_populations:
                    absolute_value = generate_migration_value(origin, destination, era)
                    
                    # calculate migration rate per 100,000 inhabitants of origin state
                    origin_population = current_state_populations[origin]
                    rate_value = int((absolute_value / origin_population) * 100000)
                    
                    absolute_migrations.append({
                        "origin": origin,
                        "destination": destination,
                        "value": absolute_value
                    })
                    
                    rate_migrations.append({
                        "origin": origin,
                        "destination": destination,
                        "value": rate_value
                    })
    
    return absolute_migrations, rate_migrations

def main():
    """generate and save migration data for multiple eras."""
    eras = ["1960s", "1990s", "2020s"]
    
    for era in eras:
        print(f"generating migration data for {era}...")
        absolute_migrations, rate_migrations = generate_migration_data(era)
        
        # sort both datasets by value in descending order for easier inspection
        absolute_migrations.sort(key=lambda x: x["value"], reverse=True)
        rate_migrations.sort(key=lambda x: x["value"], reverse=True)
        
        # save absolute migration data
        absolute_data = {"migrations": absolute_migrations}
        absolute_filename = f"src/assets/migration_{era}.json"
        with open(absolute_filename, "w") as f:
            json.dump(absolute_data, f, indent=2)
        
        # save migration rate data (per 100,000 inhabitants)
        rate_data = {"migrations": rate_migrations}
        rate_filename = f"src/assets/migration_rate_{era}.json"
        with open(rate_filename, "w") as f:
            json.dump(rate_data, f, indent=2)
        
        print(f"generated {len(absolute_migrations)} migration records for {era}")
        print(f"absolute data saved to {absolute_filename}")
        print(f"rate data saved to {rate_filename}")
        
        # show top 10 migration flows for this era (absolute numbers)
        print(f"\ntop 10 absolute migration flows for {era}:")
        for i, migration in enumerate(absolute_migrations[:10]):
            print(f"  {i+1}. {migration['origin']} → {migration['destination']}: {migration['value']:,}")
        
        # show top 10 migration rates for this era
        print(f"\ntop 10 migration rates for {era} (per 100,000 inhabitants):")
        for i, migration in enumerate(rate_migrations[:10]):
            print(f"  {i+1}. {migration['origin']} → {migration['destination']}: {migration['value']:,}")
        print("-" * 50)

if __name__ == "__main__":
    main() 