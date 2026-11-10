# World Board source fixtures

The JSON fixtures retain selected rows and the response metadata from the World Bank
[Country API](https://api.worldbank.org/v2/country/all?format=json&per_page=400),
[GDP series](https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.PP.CD?format=json&per_page=20000&mrnev=1),
[population series](https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=20000&mrnev=1)
and [IMF DataMapper](https://www.imf.org/external/datamapper/api/v1/PCPIPCH?periods=2026,2027).
The values were retrieved on 2026-11-08.

The UCDP HTML excerpts preserve the advertised Candidate download URLs from the
[latest catalog](https://ucdp.uu.se/downloads/) and
[historical catalog](https://ucdp.uu.se/downloads/olddw.html). The events in
`ucdp-2026.csv` are synthetic and exercise duplicate, missing and quoted fields.
The Afghanistan event in `ucdp-candidate-excerpt.csv` and the Cambodia event
in the test are projected from the 26.01.26.09 and 25.01.25.12 bulk CSV files.
UCDP Candidate Events is published under CC BY 4.0 by the Uppsala Conflict Data
Program, Uppsala University.

The [V-Dem release page](https://www.v-dem.net/data/the-v-dem-dataset/) and
[Country-Year Core v16 CSV archive](https://www.v-dem.net/media/datasets/V-Dem-CY-Core-v16_csv.zip)
are represented by the release block and the CSV header, respectively.
V-Dem v16 is distributed under CC BY-SA 4.0 by the Varieties of Democracy Project.
The test archive with a `v2cacamps` column uses synthetic values to exercise a
future Core release containing the exact variable.
