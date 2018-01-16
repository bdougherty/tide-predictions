# tide-predictions

> A microservice to find the nearest tide prediction station and get predictions for the next few days.

It provides a simpler and more user-friendly API than the original NOAA API.

Data provided by [NOAA CO-OPS API](https://tidesandcurrents.noaa.gov/api/).

## Usage

### With [`now`](https://now.sh)

[![Deploy to now](https://deploy.now.sh/static/button.svg)](https://deploy.now.sh/?repo=https://github.com/bdougherty/tide-predictions&env=APPLICATION)

or

```bash
$ now bdougherty/tide-predictions -e APPLICATION=xxx
```

### Manual

Deploy to your hosting provider, set the below environment variables, and start it with `npm start` or `yarn start`.

## Environment variables

Define the following environment variable:

- `APPLICATION` - [The name of your organization](https://tidesandcurrents.noaa.gov/api/#application)

## Endpoints

### `/all`

Get a list of all available prediction stations. Does not include any predictions or the weather forecast.

### `/near/:lat,:lon`

Find the 10 closest prediction stations to the specified latitude and longitude. Includes predictions for yesterday, today, and the next 2 days for each station.

### `/closest/:lat,:lon`

Find the closest prediction station to the specified latitude and longitude. Includes predictions for yesterday, today, and the next 7 days.

### `/:station`

Get tide predictions for a specific station. Includes predictions for yesterday, today, and the next 7 days.

## License

MIT © [Brad Dougherty](https://brad.is)
