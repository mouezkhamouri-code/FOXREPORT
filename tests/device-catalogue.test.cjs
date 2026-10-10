const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');

test('Catalogue validates stable offline keys, type/model links and preserves existing standard categories', () => {
    const key = 'custom_' + createHash('sha256').update('écran test').digest('hex').slice(0, 32);
    const modelKey = createHash('sha256').update(key + '\nmodèle test').digest('hex');
    const catalogue = {types: [{category: key, label: 'Écran TEST'}], models: [{model_key: modelKey, category: key, name: 'Modèle TEST'}]};
    const invalid = [
        {},
        {types: [{category: 'ipad', label: 'Renamed'}], models: []},
        {types: [{category: 'invalid', label: 'Écran TEST'}], models: []},
        {types: [], models: catalogue.models},
        {types: catalogue.types, models: [{...catalogue.models[0], model_key: 'wrong'}]},
        {types: [...catalogue.types, ...catalogue.types], models: []},
        {types: catalogue.types, models: [...catalogue.models, ...catalogue.models]},
        {types: Array(501).fill(catalogue.types[0]), models: []},
    ];
    const result = JSON.parse(execFileSync('php', ['-d', 'extension=php_mbstring.dll', '-r', `
        require 'app/report-definition.php';
        require 'app/device-catalogue.php';
        $inputs = json_decode(stream_get_contents(STDIN), true);
        $results = [];
        foreach ($inputs as $input) {
            try { $results[] = deviceCatalogueInput(json_encode($input)); }
            catch (RuntimeException $exception) { $results[] = 'rejected'; }
        }
        echo json_encode($results);
    `], {encoding: 'utf8', input: JSON.stringify([catalogue, ...invalid])}));
    assert.deepEqual(result, [catalogue, ...invalid.map(() => 'rejected')]);
});
