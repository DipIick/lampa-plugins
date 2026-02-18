(function () {
    'use strict';

    var Manifest = {
        id: 'ph_plugin_reborn',
        version: '1.0.5',
        name: 'PH',
        description: 'Video access',
        component: 'ph_component',
        source: 'https://www.pornhub.com',
        proxy: 'https://cors.eu.org/' 
    };

    var Lampa = window.Lampa;
    var Network = Lampa.Network;
    var Utils = Lampa.Utils;

    var DB = {
        get: function(name, def) {
            return Lampa.Storage.get('ph_' + name, def);
        },
        set: function(name, value) {
            Lampa.Storage.set('ph_' + name, value);
        }
    };

    var API = {
        request: function (url, success, error) {
            var proxy = DB.get('proxy', Manifest.proxy);
            var use_proxy = DB.get('use_proxy', true);
            
            // Формируем полный URL через прокси
            var final_url = (use_proxy && url.indexOf('http') === 0) ? proxy + url : url;

            var params = {
                dataType: 'text',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': Manifest.source + '/'
                }
            };

            Network.silent(final_url, function (str) {
                // Проверка на капчу или блокировку
                if (str.indexOf('captcha') > -1 || str.indexOf('human verification') > -1) {
                    Lampa.Noty.show('PH: Captcha detected (Try changing Proxy)');
                }
                success(str);
            }, function (a, c) {
                // Фоллбек: если прокси не сработал, пробуем второй популярный
                if(use_proxy && proxy.indexOf('cors.eu.org') > -1) {
                    Lampa.Noty.show('Proxy error. Retrying with fallback...');
                    var fallback = 'https://api.codetabs.com/v1/proxy?quest=';
                    Network.silent(fallback + url, success, error);
                } else {
                    error(a, c);
                }
            }, params);
        },
        
        parseCatalog: function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var items = [];
            
            // Более надежный селектор: ищем обертку картинки, так как она есть всегда
            var elements = doc.querySelectorAll('.phimage, .videoBox'); 

            elements.forEach(function (el) {
                // Поднимаемся к родительскому элементу (li или div), если нужно
                var parent = el.closest('li') || el.closest('.pcVideoListItem') || el;
                
                var linkEl = parent.querySelector('a');
                var imgEl = parent.querySelector('img');
                var titleEl = parent.querySelector('.title a, .videoTitle, span.title');
                var durEl = parent.querySelector('.duration, .marker-overlays');
                var viewEl = parent.querySelector('.views, .views var');

                if (linkEl && imgEl) {
                    // Извлекаем картинку (у PH часто src - это заглушка, а реальная в data-src)
                    var img = imgEl.getAttribute('data-src') || 
                              imgEl.getAttribute('data-mediumthumb') || 
                              imgEl.getAttribute('data-thumb_url') || 
                              imgEl.getAttribute('src');
                    
                    var title = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText.trim()) : 'Video';
                    
                    // Очистка ссылки
                    var link = linkEl.getAttribute('href');
                    if(link.indexOf('viewkey') === -1 && link.indexOf('/video/') === -1) return; // Пропускаем мусор

                    items.push({
                        url: link,
                        img: img,
                        title: title,
                        quality: durEl ? durEl.innerText.trim() : 'HD',
                        year: viewEl ? viewEl.innerText.trim() : '',
                        type: 'video'
                    });
                }
            });

            // Поиск следующей страницы
            var next_page = doc.querySelector('.pagination_next a, .page_next a, #next');
            var page = next_page ? next_page.getAttribute('href') : false;

            return { list: items, page: page };
        },

        parseFull: function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var title = doc.querySelector('.inlineFree') || doc.querySelector('h1.title');
            var desc = doc.querySelector('.video-metadata-description, .description'); 
            var poster = doc.querySelector('#player-fluid-container img, .video-wrapper img');
            
            var video_urls = [];
            
            // Метод 1: Поиск flashvars (Стандартный для PH)
            var flashvarsMatch = html.match(/flashvars_\d+\s*=\s*({.+?});/) || html.match(/var\s+flashvars\s*=\s*({.+?});/);
            
            if (flashvarsMatch) {
                try {
                    var json = JSON.parse(flashvarsMatch[1]);
                    if (json.mediaDefinitions) {
                        json.mediaDefinitions.forEach(function(media) {
                            if (media.videoUrl && (media.format === 'mp4' || media.format === 'hls')) {
                                var q = media.quality;
                                if(Array.isArray(q)) q = q[0]; 
                                video_urls.push({
                                    title: q + (isNaN(q) ? '' : 'p'),
                                    quality: parseInt(q) || 0,
                                    url: media.videoUrl
                                });
                            }
                        });
                    }
                } catch (e) { console.error('PH Parse JSON Error', e); }
            }

            // Метод 2: Поиск через regex qualityItems (для некоторых версий)
            if (video_urls.length === 0) {
                var qualityMatch = html.match(/"qualityItems":(\[.+?\])/);
                if (qualityMatch) {
                    try {
                        var qItems = JSON.parse(qualityMatch[1]);
                        qItems.forEach(function(item){
                             video_urls.push({
                                title: item.text,
                                quality: parseInt(item.text) || 0,
                                url: item.url
                            });
                        });
                    } catch(e){}
                }
            }

            video_urls.sort(function(a,b){ return b.quality - a.quality; });

            return {
                title: title ? title.innerText.trim() : 'Video',
                description: desc ? desc.innerText.trim() : '',
                img: poster ? (poster.getAttribute('src') || '') : '',
                videos: video_urls
            };
        }
    };

    function PhComponent(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            
            this.activity.head = Lampa.Template.get('head', { title: 'PH' });
            
            this.activity.head.querySelector('.open--search').addEventListener('click', function(){
                Lampa.Input.edit({
                    title: 'Search',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    comp.activity.loader(true);
                    comp.startSearch(new_value);
                });
            });

            this.activity.line = Lampa.Template.get('items_line', { title: 'Recommended' });
            this.activity.render().find('.activity__body').append(this.activity.head);
            this.activity.render().find('.activity__body').append(this.activity.line);
            
            return this.render();
        };

        comp.startSearch = function(query) {
            this.url = Manifest.source + '/video/search?search=' + encodeURIComponent(query);
            this.page = 1;
            this.activity.line.find('.card').remove();
            this.load();
        };

        comp.start = function () {
            this.url = Manifest.source;
            this.page = 1;
            this.load();
        };

        comp.load = function () {
            var _this = this;
            var requestUrl = this.url;

            API.request(requestUrl, function (html) {
                // Если HTML слишком короткий - это подозрительно
                if(html.length < 500) {
                    Lampa.Noty.show('PH: Response too short. Check Proxy.');
                }

                var data = API.parseCatalog(html);
                
                _this.buildItems(data.list);
                _this.activity.loader(false);
                
                if (data.page) {
                    _this.url = data.page;
                    if(_this.url.indexOf('http') === -1) _this.url = Manifest.source + _this.url;
                } else {
                    _this.url = false;
                }
            }, function (a, c) {
                _this.activity.loader(false);
                _this.activity.empty();
                Lampa.Noty.show('PH Network Error: ' + c);
            });
        };

        comp.buildItems = function (items) {
            var _this = this;
            
            if(!items.length) {
                // Если парсер вернул 0 элементов, но ошибки сети не было
                var emptyMsg = Lampa.Template.get('empty', {title: 'No items found', descr: 'Parser failed or content blocked'});
                this.activity.line.append(emptyMsg);
                return;
            }

            items.forEach(function (item) {
                var card = Lampa.Template.get('card', {
                    title: item.title,
                    release_year: item.year
                });

                card.find('.card__view').append('<div class="card__quality">' + item.quality + '</div>');

                var img = card.find('.card__img')[0];
                var img_url = item.img;
                
                img.onload = function () { card.addClass('card--loaded'); };
                img.error = function () { img.src = './img/img_broken.svg'; };
                img.src = img_url;

                card.on('hover:enter', function () {
                    _this.openFull(item);
                });
                
                // Долгое нажатие - Меню
                card.on('hover:long', function () {
                     Lampa.Select.show({
                        title: 'Menu',
                        items: [
                            { title: 'Add to Favorites', to_fav: true },
                            { title: 'Close' }
                        ],
                        onSelect: function(a) {
                            if(a.to_fav) {
                                Lampa.Favorite.add('card', {
                                    id: Utils.uid(item.title),
                                    title: item.title,
                                    img: img_url,
                                    url: item.url,
                                    source: 'ph'
                                });
                                Lampa.Noty.show('Added to Favorites');
                            }
                        }
                     });
                });

                _this.activity.line.find('.card-loaded').remove();
                _this.activity.line.append(card);
            });
            
            if(this.url) {
                var more = Lampa.Template.get('more');
                more.on('hover:enter', function () {
                    _this.load();
                });
                this.activity.line.append(more);
            }
            
            this.activity.toggle();
        };

        comp.openFull = function (item) {
            var full_url = item.url;
            if(full_url.indexOf('http') === -1) full_url = Manifest.source + full_url;

            Lampa.Activity.push({
                url: full_url,
                title: item.title,
                component: 'ph_full_view',
                page: 1
            });
        };

        return comp;
    }

    function PhFull(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            var _this = this;
            API.request(object.url, function(html) {
                var data = API.parseFull(html);
                
                var desc = Lampa.Template.get('description', {
                    title: data.title,
                    descr: data.description
                });
                
                Lampa.Activity.active().activity.render().find('.background').attr('src', data.img);

                var buttons = $('<div class="buttons"></div>');
                
                var btn_play = Lampa.Template.get('button', { title: 'Play Video' });
                
                btn_play.on('hover:enter', function() {
                    if(data.videos.length > 0) {
                        _this.play(data);
                    } else {
                        Lampa.Noty.show('Video links not found (Login required?)');
                    }
                });
                buttons.append(btn_play);

                _this.activity.render().find('.activity__body').append(desc);
                _this.activity.render().find('.activity__body').append(buttons);
                _this.activity.loader(false);
                _this.activity.toggle();

            }, function() {
                _this.activity.empty();
            });
        };

        comp.play = function(data) {
            var items = data.videos.map(function(vid){
                return {
                    title: vid.title,
                    url: vid.url
                };
            });

            var playVideo = function(url) {
                var video = {
                    title: data.title,
                    url: url,
                    timeline: {
                        hash: Lampa.Utils.uid(data.title)
                    }
                };
                Lampa.Player.play(video);
                Lampa.Player.playlist([video]);
            };

            if(items.length > 1) {
                Lampa.Select.show({
                    title: 'Select Quality',
                    items: items,
                    onSelect: function(a) {
                        playVideo(a.url);
                    }
                });
            } else {
                playVideo(items[0].url);
            }
        };

        return comp;
    }

    // --- Настройки ---
    function addSettings() {
        Lampa.Settings.listener.follow('open', function (e) {
            if (e.name == 'ph_settings') {
                var body = e.body;
                
                var createItem = function(name, key, def) {
                    var item = Lampa.Template.get('settings_param', {
                        name: name,
                        value: DB.get(key, def),
                        descr: ''
                    });
                    
                    item.on('hover:enter', function() {
                        Lampa.Input.edit({
                            title: name,
                            value: DB.get(key, def),
                            free: true
                        }, function(newVal) {
                            DB.set(key, newVal);
                            item.find('.settings-param__value').text(newVal);
                        });
                    });
                    
                    body.find('.settings-param__body').append(item);
                };

                createItem('CORS Proxy (Main)', 'proxy', Manifest.proxy);
                
                var toggle = Lampa.Template.get('settings_param', {
                     name: 'Use Proxy',
                     value: DB.get('use_proxy', true) ? 'Yes' : 'No'
                });
                toggle.on('hover:enter', function(){
                    var state = !DB.get('use_proxy', true);
                    DB.set('use_proxy', state);
                    toggle.find('.settings-param__value').text(state ? 'Yes' : 'No');
                });
                body.find('.settings-param__body').append(toggle);
            }
        });
    }

    if (!window.plugin_ph_ready) {
        window.plugin_ph_ready = true;
        
        Lampa.Component.add('ph_component', PhComponent);
        Lampa.Component.add('ph_full_view', PhFull);

        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') {
                var ico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"></path></svg>';
                
                var item = Lampa.Template.get('activity_menu_item', {
                    title: 'Ph',
                    icon: ico
                });

                item.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '',
                        title: 'PH',
                        component: 'ph_component',
                        page: 1
                    });
                });

                $('.activity__menu .activity__menu-list').append(item);
                
                Lampa.Settings.main().update();
                $('.settings__param').eq(0).after(Lampa.Template.get('settings_param', {
                    name: 'PH Settings',
                    component: 'ph_settings',
                    icon: ico
                }));
            }
        });
        
        addSettings();
        console.log('PH Plugin loaded');
    }

})();
