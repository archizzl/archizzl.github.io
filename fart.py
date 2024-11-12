import os

def create_directory(directory, caption):
    with open(os.path.join(directory, 'index.html'), 'w') as f:
        f.write('<html><body><h3>' + caption + '</h3><ol>')
        for filename in sorted(os.listdir(directory)):
            f.write(f'<li><a target="_blank" href="{filename}">{filename}</a></li>')
        f.write('</ol></body></html>')
    print('index.html generated.')

create_directory('./projects/artish', 'artish')
create_directory('./projects/games', 'games')
create_directory('./projects/oddities', 'oddities')