const { execSync } = require('child_process');
const fs = require('fs');

try {
    const log = execSync('git log --reverse --pretty=format:"%H|%ad|%s" --date=iso').toString().trim().split('\n');

    const changelog = log.filter(l => l.includes('|')).map((line, index) => {
        const parts = line.split('|');
        const hash = parts[0];
        const date = parts[1];
        const msg = parts.slice(2).join('|');
        const version = `2.0.${index}`;
        return {
            version,
            date: date,
            message: msg,
            hash
        };
    });

    // reverse it so latest is first
    changelog.reverse();

    fs.writeFileSync('tmp_changelog.json', JSON.stringify(changelog, null, 2));
    console.log('Changelog generated with ' + changelog.length + ' entries.');
} catch (e) {
    console.error(e);
}
