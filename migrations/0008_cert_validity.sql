-- Safeguarding certificates last 2 years and Paediatric First Aid 3 years from the issue date (previously all 1 year).
UPDATE checks SET expires_on = date(issued_on, '+2 years') WHERE type = 'safeguarding' AND issued_on IS NOT NULL;
UPDATE checks SET expires_on = date(issued_on, '+3 years') WHERE type = 'pfa' AND issued_on IS NOT NULL;
