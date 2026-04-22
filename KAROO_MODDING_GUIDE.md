# Karoo Database Modding Guide (Dla programistów i laików)

Ten dokument jest przystępnym przewodnikiem tłumaczącym, **co faktycznie znajduje się w bazach Karoo** i **co można w nich bezpiecznie modyfikować**, bez psucia urządzenia.

---

## 1. Co to jest ta "Baza Danych" w Karoo?

Karoo (bazujące na systemie Android) przechowuje wszystkie Twoje ustawienia, trasy i ekrany w plikach `.sqlite3` za pomocą systemu o nazwie **Couchbase Lite**. 

Wyobraź sobie to jako dużą tabelę Excela (`kv_default`), gdzie:
*   **Kolumna `key`** to identyfikator dokumentu (np. "To są ustawienia profilu jazdy").
*   **Kolumna `body`** to zawartość (np. "Ten profil ma 4 pola, w tym Moc i Tętno").

**Haczyk:** Zawartość (`body`) nie jest zapisanym zwykłym tekstem. Jest zapisana w **Fleece** (binarnym formacie), co oznacza, że jest skompresowana i jeśli zmienisz choćby jedną literę tak, że tekst stanie się dłuższy, zepsujesz plik i aplikacja Karoo się zawiesi!

---

## 2. Co mogę modyfikować i z czym to się je?

Główna baza, która nas interesuje, ma w nazwie Twój ID konta Hammerhead, np. `database_184576.cblite2`.

Oto najciekawsze `key` (klucze), które możesz tam znaleźć i modyfikować:

### A. Profile Jazdy (Ride Profiles)
**Format klucza:** `184576.ride_profile.nazwa-profilu` (np. `...ride_profile.indoor-power`)

W pliku binarnym profilu jazdy znajdziesz zaszyte następujące flagi i wartości tekstowe, które decydują o zachowaniu urządzenia:

*   **Nazwa wyświetlana:** To tekst, który widzisz na głównym ekranie Karoo (np. "Basic Profile", "Heart Rate").
    *   *Jak modyfikować:* Możesz zmienić nazwę w pliku, ale **NOWA NAZWA MUSI MIEĆ DOKŁADNIE TYLE SAMO ZNAKÓW CO STARA**. 
    *   *Przykład:* Zmiana `nexus-pro` (9 znaków) na `nexus    ` (5 liter + 4 spacje). Urządzenie obetnie spacje, ale format binarny bazy pozostanie nienaruszony!

*   **Flagi funkcji (Włącz/Wyłącz):** W kodzie binarnym są pola takie jak `audioAlertsRadarEnabled` (Dźwięki radaru), `phoneNotificationsEnabled` (Powiadomienia z telefonu), `liveSegmentsEnabled` (Segmenty Strava na żywo).
    *   *Uwaga:* To są klucze w formacie Fleece. Bez specjalnego parsera w aplikacji Nexus, ręczna edycja tych wartości binarnych jest ryzykowna.

*   **Układy Ekranów (Pages & Layouts):**
    *   Wartości takie jak `Page 1`, `Page 2`.
    *   Pod każdą stroną znajdują się identyfikatory metryk, które Karoo wyświetla na kafelkach.

### B. Metryki (To co widzisz na ekranie w czasie jazdy)
Jeśli analizujesz kod binarny układu ekranu, Karoo używa wewnętrznych identyfikatorów z prefixem `TYPE_`. Oto co oznaczają w praktyce:

*Lista wymieniona powyżej to tylko część. Po przeskanowaniu pełnej, binarnej bazy danych wyodrębniłem **wszystkie dostępne pola metryk**, których Karoo używa wewnętrznie. Możesz ich użyć przy tworzeniu własnych szablonów:*

**Moc (Power):**
*   `TYPE_POWER_ID` -> Aktualna moc
*   `TYPE_3S_AVERAGE_POWER_ID` -> Moc uśredniona 3-sekundowa
*   `TYPE_AVERAGE_POWER_ID` -> Średnia moc z treningu
*   `TYPE_MAX_POWER_ID` -> Maksymalna moc
*   `TYPE_NORMALIZED_POWER_ID` -> Znormalizowana moc (NP)
*   `TYPE_POWER_LAP_ID` -> Średnia moc z obecnego okrążenia

**Tętno (Heart Rate):**
*   `TYPE_HEART_RATE_ID` -> Aktualne tętno
*   `TYPE_AVERAGE_HR_ID` -> Średnie tętno

**Prędkość i Kadencja:**
*   `TYPE_SPEED_ID` -> Aktualna prędkość
*   `TYPE_AVERAGE_SPEED_ID` -> Średnia prędkość
*   `TYPE_AVERAGE_SPEED_LAP_ID` -> Średnia prędkość okrążenia
*   `TYPE_MAX_SPEED_ID` -> Maksymalna prędkość
*   `TYPE_MAX_SPEED_LAP_ID` -> Maks. prędkość okrążenia
*   `TYPE_CADENCE_ID` -> Kadencja (RPM)
*   `TYPE_AVERAGE_CADENCE_ID` -> Średnia kadencja
*   `TYPE_MAX_CADENCE_ID` -> Maksymalna kadencja

**Dystans i Czas:**
*   `TYPE_DISTANCE_ID` -> Dystans całkowity
*   `TYPE_DISTANCE_LAP_ID` -> Dystans okrążenia
*   `TYPE_ELAPSED_TIME_ID` -> Czas całkowity (Brutto)
*   `TYPE_ELAPSED_TIME_LAP_ID` -> Czas okrążenia
*   `TYPE_RIDE_TIME_ID` -> Czas jazdy (Netto)
*   `TYPE_PAUSED_TIME_ID` -> Czas pauzy
*   `TYPE_LAP_NUMBER_ID` -> Numer obecnego okrążenia

**Wysokość (Elevation):**
*   `TYPE_ELEVATION_GAIN_ID` -> Całkowity wznios
*   `TYPE_ELEVATION_GAIN_LAP_ID` -> Wznios okrążenia
*   `TYPE_ELEVATION_LOSS_ID` -> Całkowity spadek
*   `TYPE_ELEVATION_LOSS_LAP_ID` -> Spadek okrążenia
*   `TYPE_AVERAGE_ELEVATION_ID` -> Średnia wysokość
*   `TYPE_AVERAGE_ELEVATION_LAP_ID` -> Śr. wysokość okrążenia
*   `TYPE_MAX_ELEVATION_ID` -> Maksymalna wysokość
*   `TYPE_MAX_ELEVATION_LAP_ID` -> Maks. wysokość okrążenia
*   `TYPE_MIN_ELEVATION_ID` -> Minimalna wysokość
*   `TYPE_MIN_ELEVATION_LAP_ID` -> Min. wysokość okrążenia
*   `TYPE_AVERAGE_VERTICAL_SPEED_ID` -> Średnia prędkość pionowa (VAM)
*   `TYPE_AVERAGE_VERTICAL_SPEED_LAP_ID` -> VAM okrążenia

**Inne:**
*   `TYPE_TEMPERATURE_ID` -> Temperatura
*   `TYPE_WORKOUT_ID` -> Ekran/Wskaźnik ustrukturyzowanego treningu (Workout)

*Co to daje Programiście?* Znając te klucze, aplikacja Nexus może "wstrzykiwać" gotowe szablony ekranów do bazy. Jeśli ułożysz w kreatorze, że chcesz mieć na samej górze `Moc 3s`, Nexus znajdzie w binarnym ciągu miejsce na pierwsze pole i wpisze tam `TYPE_3S_AVERAGE_POWER_ID`.

### C. Zapisane Trasy i Treningi
*   **Klucz Tras:** `184576.route.<losowy_identyfikator>`
    *   Oznacza trasę pobraną z chmury. Można tu wyciągnąć plik trasy, a potencjalnie wstrzyknąć własne punkty nawigacyjne z pominięciem serwerów Hammerhead.
*   **Klucz Treningów:** `184576.workout.<losowy_identyfikator>`
    *   Treningi z TrainingPeaks. Można wstrzykiwać własne, lokalnie wygenerowane pliki treningów bez płacenia za subskrypcje premium zewnętrznych serwisów.

---

## 3. Złote Zasady Moddera (OSTRZEŻENIE)

Jeśli próbujesz modyfikować te bazy danych:

1.  **Zasada Długości (Length Rule):** Zmieniając jakikolwiek tekst w hex-edytorze lub skrypcie (np. nazwę profilu), ciąg musi mieć taką samą długość co w oryginale! Krótsze nazwy dopełniaj znakami spacji na końcu. Jeśli zmienisz długość pliku chociaż o 1 bajt, baza padnie.
2.  **Zasada Demona (Kill the Daemon):** Zawsze przed wgrywaniem zmodyfikowanej bazy na Karoo musisz ubić proces `io.hammerhead.datasyncservice`. Inaczej system nadpisze Twoje zmiany danymi z chmury lub zawiesi się z powodu konfliktu plików.
3.  **Kopie Zapasowe:** Każda operacja "Sideload" w Nexusie robi lokalną kopię starej bazy w folderze `scratch/databases`. Zawsze możesz użyć polecenia ADB `push`, aby wrzucić starą bazę z powrotem.

## Podsumowanie dla Laika

**Karoo** to pod maską po prostu smartfon z Androidem bez ekranu dotykowego telefonu. Baza danych, którą tu hakujemy, to plik w którym zapisuje się "Zrób czarne tło, wyświetl 4 pola i nazwij to Basic Profile".

Ponieważ firma Hammerhead zablokowała możliwość ręcznego podmieniania tych danych na komputerze (ukrywając je w skompresowanym formacie binarnym), stworzyliśmy narzędzie **Nexus**, które "oszukuje" system, wklejając nowe ustawienia jak chirurg — dbając o to, by system Karoo myślał, że sam dokonał tych zmian.
