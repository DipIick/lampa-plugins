(function () {
    'use strict';

    // Settings & Manifest
    var Manifest = {
        id: 'ph_master_plugin',
        version: '2.0.0',
        name: 'PH Master',
        component: 'ph_mod_component',
        source: 'https://www.pornhub.com', // Используем глобальный домен
        cookie: 'age_verified=1; platform=pc' // Важно для обхода плашки 18+
    };

    var Lampa = window.Lampa;
    var Network = Lampa.Network;
    var Utils = Lampa.Utils;
    var Storage = Lampa.Storage;

    // --- API & Parsing Logic (Ported from working mods) ---
    var Api = {
        // Проксирование запросов
        get: function (method, params, success, error) {
            var url = Manifest.source + method;
            var proxy_url = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url + (params ? params : ''));
            
            // Если включен "Свой прокси" в настройках Lampa, используем его
            var custom_proxy = Storage.get('ph_custom_proxy', '');
            if(custom_proxy) proxy_url = custom_proxy + url + (params ? params : '');

            Network.silent(proxy_url, function(str) {
                success(str);
            }, error);
        },

        // Парсинг каталога (Главная / Поиск / Категории)
        list: function (html) {
            var items = [];
            var doc = new DOMParser().parseFromString(html, 'text/html');
            
            // Основной контейнер видео
            var elements = doc.querySelectorAll('#videoCategory .videoblock, #mostRecentVideos .videoblock, .videoblock, .pcVideoListItem');
            
            if(!elements.length) elements = doc.querySelectorAll('.phimage'); // Fallback

            elements.forEach(function (el) {
                var link_el = el.querySelector('a:not(.userLink)');
                var img_el = el.querySelector('img');
                var title_el = el.querySelector('.title a, .videoTitle');
                var time_el = el.querySelector('.duration');
                
                if (link_el && img_el && title_el) {
                    var link = link_el.getAttribute('href');
                    var title = title_el.getAttribute('title') || title_el.innerText;
                    var img = img_el.getAttribute('data-mediumthumb') || img_el.getAttribute('data-src') || img_el.src;
                    var time = time_el ? time_el.innerText.trim() : '';
                    
                    // Фильтруем мусор
                    if (link.indexOf('viewkey') !== -1) {
                        items.push({
                            type: 'video',
                            title: title,
                            url: link,
                            img: img,
                            time: time,
                            background_image: img
                        });
                    }
                }
            });
            
            // Пагинация
            var next = doc.querySelector('.pagination_next a, li.page_next a');
            var next_page = next ? next.getAttribute('href') : false;

            return { results: items, page: next_page };
        },

        // Парсинг страницы видео (Extraction)
        extract: function (html) {
            // Регулярки из популярных скриптов-грабберов
            var flashvars = html.match(/flashvars_\d+\s*=\s*({.+?});/);
            var video_data = {};

            if (flashvars) {
                try {
                    var json = JSON.parse(flashvars[1]);
                    video_data = {
                        title: json.video_title,
                        img: json.image_url,
                        duration: json.video_duration,
                        videos: []
                    };

                    if (json.mediaDefinitions) {
                        json.mediaDefinitions.forEach(function (v) {
                            if (v.format === 'mp4' && v.videoUrl) {
                                var q = v.quality;
                                if(Array.isArray(q)) q = q[0];
                                video_data.videos.push({
                                    title: q + 'p',
                                    quality: parseInt(q),
                                    url: v.videoUrl
                                });
                            }
                        });
                    }
                } catch (e) {}
            }
            
            // Сортировка качества
            if(video_data.videos) {
                video_data.videos.sort(function(a,b){ return b.quality - a.quality });
            }

            return video_data;
        }
    };

    // --- UI Component (Lampa Standard) ---
    function Component(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            this.page_url = ''; 
            this.build();
        };

        comp.build = function () {
            var _this = this;
            
            // Шапка
            this.activity.head = Lampa.Template.get('head', { title: 'PH' });
            
            // Кнопка поиска
            this.activity.head.querySelector('.open--search').addEventListener('click', function () {
                Lampa.Input.edit({
                    title: 'Поиск',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    _this.activity.loader(true);
                    _this.search(new_value);
                });
            });

            // Контейнер
            this.activity.line = Lampa.Template.get('items_line', { title: 'Рекомендации' });
            this.activity.render().find('.activity__body').append(this.activity.head);
            this.activity.render().find('.activity__body').append(this.activity.line);
            
            this.load('/');
        };

        comp.search = function (query) {
            this.activity.line.find('.card').remove();
            this.load('/video/search?search=' + encodeURIComponent(query));
        };

        comp.load = function (endpoint) {
            var _this = this;
            
            // Если endpoint полный url (пагинация)
            var is_full = endpoint.indexOf('http') > -1;
            var method = is_full ? '' : endpoint;
            var params = is_full ? endpoint : ''; // Костыль для прокси

            // Если пагинация - берем часть после домена для метода, если надо
            if(is_full) {
                 // Здесь прокси сам разберется, передаем пустой метод и полный урл в params
                 method = ''; 
                 Api.get('', endpoint, success, error);
            } else {
                 Api.get(method, '', success, error);
            }

            function success(html) {
                var data = Api.list(html);
                _this.append(data);
                _this.activity.loader(false);
            }

            function error(a) {
                _this.activity.loader(false);
                Lampa.Noty.show('Ошибка сети. Проверьте VPN/Прокси');
                _this.activity.empty();
            }
        };

        comp.append = function (data) {
            var _this = this;
            
            if(!data.results.length) {
                Lampa.Noty.show('Список пуст. Возможно, блокировка.');
                return;
            }

            data.results.forEach(function (element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: element.time
                });
                
                // Стилизация карточки
                card.addClass('card--video');
                card.find('.card__view').append('<div class="card__quality">HD</div>');
                
                var img = card.find('.card__img')[0];
                img.onload = function () { card.addClass('card--loaded'); };
                img.onerror = function () { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                // Клик - открытие
                card.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: element.url,
                        title: element.title,
                        component: 'ph_mod_view',
                        page: 1
                    });
                });
                
                // Меню (Избранное)
                card.on('hover:long', function () {
                    var menu = [
                        { title: 'В избранное', action: 'fav' }
                    ];
                    Lampa.Select.show({
                        title: 'Меню',
                        items: menu,
                        onSelect: function(a){
                            if(a.action == 'fav'){
                                Lampa.Favorite.add('card', {
                                    id: Lampa.Utils.uid(element.title),
                                    title: element.title,
                                    img: element.img,
                                    url: element.url,
                                    source: 'ph_mod'
                                });
                                Lampa.Noty.show('Добавлено');
                            }
                        }
                    });
                });

                _this.activity.line.append(card);
            });

            // Пагинация (Кнопка "Дальше")
            if (data.page) {
                var more = Lampa.Template.get('more');
                // Фикс URL пагинации
                var next_url = data.page;
                
                more.on('hover:enter', function () {
                    _this.activity.line.find('.selector').remove(); // удаляем кнопку
                    _this.load(next_url);
                });
                this.activity.line.append(more);
            }
            
            this.activity.toggle();
        };

        return comp;
    }

    // --- Video Player Component ---
    function View(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            var _this = this;
            Api.get(object.url, '', function(html){
                var data = Api.extract(html);
                
                if(data.videos && data.videos.length){
                    _this.showDetails(data);
                } else {
                    Lampa.Noty.show('Видео не найдено (Login required?)');
                    _this.activity.empty();
                }
            }, function(){
                _this.activity.empty();
            });
        };
        
        comp.showDetails = function(data) {
            var _this = this;
            
            // Рендер описания
            var desc = Lampa.Template.get('description', {
                title: data.title,
                descr: 'Duration: ' + data.duration
            });
            
            // Фон
            Lampa.Activity.active().activity.render().find('.background').attr('src', data.img);

            // Кнопка Play
            var btn = Lampa.Template.get('button', { title: 'Смотреть' });
            btn.on('hover:enter', function(){
                _this.play(data.videos, data.title);
            });
            
            this.activity.render().find('.activity__body').append(desc);
            this.activity.render().find('.activity__body').append(btn);
            this.activity.loader(false);
            this.activity.toggle();
        };

        comp.play = function(videos, title) {
            // Меню выбора качества
            Lampa.Select.show({
                title: 'Качество',
                items: videos,
                onSelect: function(v){
                    var video_item = {
                        title: title,
                        url: v.url,
                        timeline: { hash: Lampa.Utils.uid(title) }
                    };
                    Lampa.Player.play(video_item);
                    Lampa.Player.playlist([video_item]);
                }
            });
        };

        return comp;
    }

    // --- Initialization ---
    if (!window.ph_mod_loaded) {
        window.ph_mod_loaded = true;
        
        Lampa.Component.add('ph_mod_component', Component);
        Lampa.Component.add('ph_mod_view', View);

        // Добавляем в настройки поле для своего прокси
        Lampa.Settings.listener.follow('open', function (e) {
            if(e.name == 'main') {
                var item = Lampa.Template.get('settings_param', {
                    name: 'PH Proxy',
                    value: Storage.get('ph_custom_proxy', 'Default'),
                    descr: 'Укажите свой CORS прокси если не работает'
                });
                item.on('hover:enter', function(){
                    Lampa.Input.edit({
                        title: 'CORS Proxy URL',
                        value: Storage.get('ph_custom_proxy', ''),
                        free: true
                    }, function(val){
                        Storage.set('ph_custom_proxy', val);
                        item.find('.settings-param__value').text(val || 'Default');
                    });
                });
                e.body.find('.settings-param__body').append(item);
            }
        });

        // Добавляем кнопку в меню
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') {
                var ico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"></path></svg>';
                var item = Lampa.Template.get('activity_menu_item', {
                    title: 'PH',
                    icon: ico
                });
                item.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '',
                        title: 'PH',
                        component: 'ph_mod_component',
                        page: 1
                    });
                });
                $('.activity__menu .activity__menu-list').append(item);
            }
        });
        
        console.log('PH Mod Plugin Loaded');
    }
})();
