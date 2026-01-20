import json
import os

def load_data():
    """load flights and puzzle description from json files."""
    try:
        with open("assets/flights.json", "r") as f:
            flights = json.load(f)
        with open("assets/puzzle_description.json", "r") as f:
            puzzle = json.load(f)
        return flights, puzzle
    except FileNotFoundError as e:
        print(f"❌ error: {e}")
        print("make sure to run the generator script first to create the data files.")
        return None, None

def find_solutions(flights, puzzle):
    """find all valid solutions that satisfy the puzzle constraints."""
    user_1 = puzzle["friends"]["user_1"]
    user_2 = puzzle["friends"]["user_2"]
    
    solutions = []
    
    # get all possible destination airports
    destinations = set(flight["destination"] for flight in flights)
    
    for destination in destinations:
        # get flights to this destination for each user
        user_1_flights = [f for f in flights if 
                         f["origin"] == user_1["origin_airport"] and 
                         f["destination"] == destination]
        
        user_2_flights = [f for f in flights if 
                         f["origin"] == user_2["origin_airport"] and 
                         f["destination"] == destination]
        
        # check each combination for valid solutions
        for flight_1 in user_1_flights:
            for flight_2 in user_2_flights:
                # ensure both users cannot book the same flight id
                if flight_1["id"] == flight_2["id"]:
                    continue
                    
                if is_valid_solution(flight_1, flight_2, user_1, user_2):
                    solutions.append({
                        "destination": destination,
                        "date": flight_1["date"],
                        "user_1_flight": {
                            "id": flight_1["id"],
                            "price": flight_1["price"],
                            "airline": flight_1["airline"]["code"],
                            "duration": flight_1["duration"]
                        },
                        "user_2_flight": {
                            "id": flight_2["id"],
                            "price": flight_2["price"],
                            "airline": flight_2["airline"]["code"],
                            "duration": flight_2["duration"]
                        }
                    })
    
    return solutions

def is_valid_solution(flight_1, flight_2, user_1, user_2):
    """check if two flights form a valid solution."""
    # must arrive on the same date
    if flight_1["date"] != flight_2["date"]:
        return False
    
    # date must be available for both users
    if (flight_1["date"] not in user_1["available_dates"] or 
        flight_1["date"] not in user_2["available_dates"]):
        return False
    
    # flights must be within budget
    if (flight_1["price"] > user_1["max_budget"] or 
        flight_2["price"] > user_2["max_budget"]):
        return False
    
    # users must use their preferred airlines
    if (flight_1["airline"]["code"] not in user_1["preferred_airlines"] or
        flight_2["airline"]["code"] not in user_2["preferred_airlines"]):
        return False
    
    return True

def analyze_solutions(solutions):
    """analyze and categorize the solutions."""
    if not solutions:
        return {
            "total_count": 0,
            "by_destination": {},
            "by_date": {},
            "by_airline_combo": {}
        }
    
    # group by destination
    by_destination = {}
    for sol in solutions:
        dest = sol["destination"]
        if dest not in by_destination:
            by_destination[dest] = []
        by_destination[dest].append(sol)
    
    # group by date
    by_date = {}
    for sol in solutions:
        date = sol["date"]
        if date not in by_date:
            by_date[date] = []
        by_date[date].append(sol)
    
    # group by airline combination
    by_airline_combo = {}
    for sol in solutions:
        combo = f"{sol['user_1_flight']['airline']}-{sol['user_2_flight']['airline']}"
        if combo not in by_airline_combo:
            by_airline_combo[combo] = []
        by_airline_combo[combo].append(sol)
    
    return {
        "total_count": len(solutions),
        "by_destination": by_destination,
        "by_date": by_date,
        "by_airline_combo": by_airline_combo
    }

def print_analysis(analysis, solutions):
    """print detailed analysis of solutions."""
    print("🔍 PUZZLE SOLUTION ANALYSIS")
    print("=" * 60)
    
    if analysis["total_count"] == 0:
        print("❌ no valid solutions found!")
        print("the puzzle may be too difficult with current constraints.")
        return
    
    print(f"✅ total valid solutions found: {analysis['total_count']}")
    print()
    
    # solutions by destination
    print("📍 SOLUTIONS BY DESTINATION:")
    print("-" * 30)
    for dest, dest_solutions in analysis["by_destination"].items():
        print(f"{dest}: {len(dest_solutions)} solution(s)")
        # show first solution for each destination
        if dest_solutions:
            sol = dest_solutions[0]
            print(f"  example: {sol['date']} - user 1: ${sol['user_1_flight']['price']} ({sol['user_1_flight']['airline']}), "
                  f"user 2: ${sol['user_2_flight']['price']} ({sol['user_2_flight']['airline']})")
    print()
    
    # solutions by date
    print("📅 SOLUTIONS BY DATE:")
    print("-" * 30)
    for date, date_solutions in analysis["by_date"].items():
        print(f"{date}: {len(date_solutions)} solution(s)")
    print()
    
    # solutions by airline combination
    print("✈️  SOLUTIONS BY AIRLINE COMBINATION:")
    print("-" * 30)
    for combo, combo_solutions in analysis["by_airline_combo"].items():
        print(f"{combo}: {len(combo_solutions)} solution(s)")
    print()
    
    # detailed list of all solutions
    print("📋 DETAILED SOLUTION LIST:")
    print("-" * 30)
    for i, sol in enumerate(solutions, 1):
        print(f"{i}. destination: {sol['destination']}, date: {sol['date']}")
        print(f"   user 1: flight #{sol['user_1_flight']['id']} - ${sol['user_1_flight']['price']} ({sol['user_1_flight']['airline']}) - {sol['user_1_flight']['duration']}h")
        print(f"   user 2: flight #{sol['user_2_flight']['id']} - ${sol['user_2_flight']['price']} ({sol['user_2_flight']['airline']}) - {sol['user_2_flight']['duration']}h")
        print()

def main():
    """main function to run the analysis."""
    print("🚀 loading puzzle data...")
    flights, puzzle = load_data()
    
    if flights is None or puzzle is None:
        return
    
    print(f"📊 loaded {len(flights)} flights")
    print("🔍 searching for valid solutions...")
    
    solutions = find_solutions(flights, puzzle)
    analysis = analyze_solutions(solutions)
    
    print_analysis(analysis, solutions)
    
    # save results to file
    results = {
        "analysis_summary": analysis,
        "all_solutions": solutions,
        "puzzle_info": {
            "user_1_budget": puzzle["friends"]["user_1"]["max_budget"],
            "user_2_budget": puzzle["friends"]["user_2"]["max_budget"],
            "overlap_dates": puzzle["constraints"]["overlap_dates"]
        }
    }
    
    os.makedirs("assets", exist_ok=True)
    with open("assets/solution_analysis.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"💾 analysis saved to assets/solution_analysis.json")

if __name__ == "__main__":
    main() 