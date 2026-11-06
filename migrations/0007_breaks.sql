-- Break out / break in at the sign-in station: [{"out":"<iso>","in":"<iso>|null","by":"pin|manager|phone"}]
ALTER TABLE shifts ADD COLUMN breaks TEXT;
