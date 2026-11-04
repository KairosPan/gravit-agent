// prints the one variable the env-file fixture sets: the market script form test reads it
console.log(process.env.MARKET_FIXTURE_TOKEN ?? "unset");
